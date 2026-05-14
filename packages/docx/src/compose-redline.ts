import { loadDocx } from './docx-file.js';
import {
  TrackedChangesEditor,
  bodyParagraphInfos,
} from './tracked-changes.js';
import type { XmlNode } from './types.js';
import type {
  DocumentDiffResult,
  ParagraphDiffEvent,
} from '@teamsuzie/docx-diff';

export interface ComposeRedlineOptions {
  /** The "before" / "left" document's raw bytes — must be a valid .docx. */
  leftBytes: Buffer | Uint8Array;
  /**
   * Optional "after" / "right" document's raw bytes. When provided, every
   * inserted paragraph in the redline inherits its `<w:pPr>` and first-run
   * `<w:rPr>` from the SOURCE paragraph in the right document (looked up
   * by `event.rightIndex`) — so spacing, alignment, list numbering, and
   * heading styles match what the right document actually had. Without
   * this, inserted paragraphs fall back to the left-side anchor's pPr,
   * which can drift on line spacing / numbering when the right doc has
   * explicit pPr the left's neighbour doesn't share.
   */
  rightBytes?: Buffer | Uint8Array;
  /** The diff produced by `runDocumentDiff(left, right, ...)`. */
  diff: DocumentDiffResult;
  /** Author name written into every revision (`<w:ins>` / `<w:del>` `w:author`). */
  author: string;
  /** ISO 8601 timestamp; defaults to now. */
  date?: string;
}

/**
 * Compose a tracked-change `.docx` from a left-vs-right paragraph diff.
 * The resulting bytes open in Word with native tracked changes:
 * accept-all reproduces the right document; reject-all reproduces the left.
 *
 * Algorithm:
 *
 *   1. Load the left document via `@teamsuzie/docx`.
 *   2. Walk the diff events forward once to annotate every `inserted` event
 *      with the leftIndex of the most recent matched (or deleted) paragraph
 *      that precedes it — that's the anchor we'll insert *after* on the
 *      left side.
 *   3. Walk the annotated events in REVERSE order, applying mutations to
 *      the live document. Reverse order keeps earlier indices stable while
 *      `insertParagraph` shifts subsequent ones — `applyParagraphDiff` and
 *      `deleteParagraph` don't shift indices because they mutate paragraphs
 *      in place rather than removing them.
 *   4. `file.save()` returns the new bytes.
 *
 * Modified paragraphs lose run-level formatting (`<w:rPr>` — bold, italic,
 * color); `<w:pPr>` is preserved so headings and styled paragraphs keep
 * their style. Deleted paragraphs preserve their original runs and just
 * get wrapped in `<w:del>`. Inserted paragraphs are plain runs — caller
 * could pass `pPr` later to inherit a neighbour's style.
 */
export function composeRedline(opts: ComposeRedlineOptions): Buffer {
  const file = loadDocx(opts.leftBytes);
  const editor = new TrackedChangesEditor(file, {
    name: opts.author,
    ...(opts.date ? { date: opts.date } : {}),
  });

  // When the right document is available, parse its body paragraphs once so
  // we can look up the source-side pPr/rPr for each inserted paragraph.
  // Cheap (one parse for the whole document); the caller skips this entire
  // path by not passing rightBytes when right-side fidelity isn't needed.
  const rightInfos = opts.rightBytes
    ? bodyParagraphInfos(loadDocx(opts.rightBytes))
    : null;

  // (2) Annotate inserted events with leftAnchorIndex.
  type Annotated =
    | (ParagraphDiffEvent & { kind: 'unchanged' | 'modified' | 'deleted' })
    | {
        kind: 'inserted';
        rightIndex: number;
        text: string;
        leftAnchorIndex: number;
      };
  const annotated: Annotated[] = [];
  let lastLeft = -1;
  for (const ev of opts.diff.events) {
    if (ev.kind === 'inserted') {
      annotated.push({
        kind: 'inserted',
        rightIndex: ev.rightIndex,
        text: ev.text,
        leftAnchorIndex: lastLeft,
      });
    } else {
      annotated.push(ev);
      lastLeft = ev.leftIndex;
    }
  }

  // (3) Apply in reverse order. Two formatting-preservation tweaks:
  //   - For modified paragraphs, copy the first existing run's `<w:rPr>`
  //     onto every generated run, so font/size/bold survive on paragraphs
  //     with uniform run formatting (the common case in legal drafting).
  //   - For inserted paragraphs, inherit the left-side anchor's `<w:pPr>`
  //     so the new paragraph picks up the surrounding paragraph style
  //     (alignment, spacing, list numbering, indentation). When the
  //     anchor is -1 (insert at start), borrow from paragraph 0 instead.
  //   We grab pPr BEFORE applying any mutations to that anchor — reverse
  //   order means the anchor paragraph hasn't been mutated yet at the
  //   time we read its pPr.
  for (let i = annotated.length - 1; i >= 0; i--) {
    const ev = annotated[i];
    if (ev.kind === 'unchanged') continue;
    if (ev.kind === 'modified') {
      editor.applyParagraphDiff(ev.leftIndex, ev.ops, {
        inheritFormatting: true,
      });
    } else if (ev.kind === 'deleted') {
      editor.deleteParagraph(ev.leftIndex);
    } else {
      // Right-side first: source paragraph's pPr/rPr give correct
      // spacing, numbering, alignment, font, etc. for the inserted
      // paragraph. Fall back to the left anchor's pPr only when the
      // right doc isn't available (or its index lookup fails).
      let pPr: XmlNode | undefined;
      let rPr: XmlNode | undefined;
      const rightInfo = rightInfos?.[ev.rightIndex];
      if (rightInfo?.pPr) pPr = rightInfo.pPr;
      if (rightInfo?.firstRunRPr) rPr = rightInfo.firstRunRPr;
      if (!pPr) {
        const anchor = ev.leftAnchorIndex >= 0 ? ev.leftAnchorIndex : 0;
        pPr = editor.getBodyParagraphPPr(anchor) ?? undefined;
      }
      const insertOpts: { pPr?: XmlNode; rPr?: XmlNode } = {};
      if (pPr) insertOpts.pPr = pPr;
      if (rPr) insertOpts.rPr = rPr;
      editor.insertParagraph(
        ev.leftAnchorIndex,
        ev.text,
        Object.keys(insertOpts).length > 0 ? insertOpts : undefined,
      );
    }
  }

  return file.save();
}

/** Slugify left/right names into a download filename. */
export function redlineDownloadFilename(
  leftName: string,
  rightName: string,
): string {
  const stripExt = (s: string) => s.replace(/\.docx$/i, '');
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);
  return `${slug(stripExt(leftName))}__vs__${slug(stripExt(rightName))}__redline.docx`;
}
