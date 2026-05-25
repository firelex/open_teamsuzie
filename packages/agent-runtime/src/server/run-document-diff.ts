import {
  alignParagraphs, diffWords,
  type DocumentDiffResult, type ParagraphDiffEvent,
} from '@teamsuzie/docx-diff';
import { bodyParagraphTexts, loadDocx } from '@teamsuzie/docx';
import { convertFileToMarkdown } from '@teamsuzie/document-conversion';
import type { FileRecord } from './files-route.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isDocxRecord(record: FileRecord): boolean {
  return (
    record.mimeType === DOCX_MIME ||
    record.name.toLowerCase().endsWith('.docx')
  );
}

/**
 * Extract one paragraph-text per main-document `<w:p>` for a DOCX
 * (OOXML-direct via `bodyParagraphTexts`), or per markdown paragraph
 * block for everything else.
 *
 * **Why the DOCX branch matters:** mammoth-derived markdown drops
 * empty paragraphs (used in legal drafting for spacing), so its
 * paragraph stream is shorter than the OOXML body's `<w:p>` count.
 * If those mammoth indices were fed back to `TrackedChangesEditor`,
 * the editor would operate on the wrong paragraphs (its body-paragraph
 * indices include empties). Going OOXML-direct keeps indices in sync.
 *
 * Non-DOCX inputs (PDF etc.) still go through markitdown/mammoth — we
 * can't apply tracked changes to them anyway since the redline compose
 * step only writes DOCX.
 */
async function extractParagraphsFor(
  record: FileRecord,
  opts: { markitdownBaseUrl: string; fetchImpl?: typeof fetch },
): Promise<string[]> {
  if (isDocxRecord(record)) {
    return bodyParagraphTexts(loadDocx(record.bytes));
  }
  const md = await convertFileToMarkdown(record, {
    markitdownAgentBaseUrl: opts.markitdownBaseUrl,
    fetchImpl: opts.fetchImpl,
  });
  return splitParagraphs(md);
}

/**
 * Pure helper: extract paragraphs from each side, align via
 * Needleman–Wunsch, then run word-level diff on each matched pair. The
 * result is one ordered sequence of events (unchanged stitched in
 * order, insertions slotted at their B-position relative to surrounding
 * anchors, deletions at their A-position).
 *
 * `leftIndex` on every event is the LEFT body-paragraph index — same
 * index space `TrackedChangesEditor` uses, so callers can pipe events
 * straight into `composeRedline` / `applyParagraphDiff` without
 * translation.
 *
 * Ported from suzielaw's `diff-engine.ts`.
 */
export async function runDocumentDiff(
  left: FileRecord,
  right: FileRecord,
  opts: { markitdownBaseUrl: string; fetchImpl?: typeof fetch },
): Promise<DocumentDiffResult> {
  const [leftParas, rightParas] = await Promise.all([
    extractParagraphsFor(left, opts),
    extractParagraphsFor(right, opts),
  ]);

  const { matches, unmatchedB } = alignParagraphs(leftParas, rightParas);

  const events: ParagraphDiffEvent[] = [];
  const unmatchedBSet = new Set(unmatchedB);
  const stats = {
    unchanged: 0,
    modified: 0,
    deleted: 0,
    inserted: 0,
    moved: 0,
  };

  let bCursor = 0;
  const flushInsertsUpTo = (target: number) => {
    while (bCursor < target) {
      if (unmatchedBSet.has(bCursor)) {
        events.push({
          kind: 'inserted',
          rightIndex: bCursor,
          text: rightParas[bCursor],
        });
        stats.inserted++;
      }
      bCursor++;
    }
  };

  for (const match of matches) {
    if (match.bIndex === null) {
      events.push({
        kind: 'deleted',
        leftIndex: match.aIndex,
        text: match.aText,
      });
      stats.deleted++;
      continue;
    }
    flushInsertsUpTo(match.bIndex);
    bCursor = match.bIndex + 1;

    if (match.aText === match.bText) {
      events.push({
        kind: 'unchanged',
        leftIndex: match.aIndex,
        rightIndex: match.bIndex,
        text: match.aText,
      });
      stats.unchanged++;
    } else {
      events.push({
        kind: 'modified',
        leftIndex: match.aIndex,
        rightIndex: match.bIndex,
        leftText: match.aText,
        rightText: match.bText,
        ops: diffWords(match.aText, match.bText),
        similarity: match.similarity,
        moved: match.status === 'moved',
      });
      stats.modified++;
      if (match.status === 'moved') stats.moved++;
    }
  }
  flushInsertsUpTo(rightParas.length);

  return {
    left: { name: left.name, paragraphs: leftParas.length },
    right: { name: right.name, paragraphs: rightParas.length },
    stats,
    events,
  };
}

/**
 * Split a markdown blob into paragraphs on blank lines. Each paragraph
 * is trimmed, has emphasis-style markdown stripped (so a Word "Address"
 * run that mammoth emits as `**Address**` doesn't collide with our
 * redline `**inserted**` markers), and empty paragraphs are dropped.
 *
 * List markers (`- `, `1. `), heading marks (`# `), and blockquotes are
 * preserved — in legal drafting those characters often ARE content
 * (section numbers, especially).
 */
function splitParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n+/g)
    .map((p) => stripMarkdownEmphasis(p.trim()))
    .filter((p) => p.length > 0);
}

function stripMarkdownEmphasis(s: string): string {
  return (
    s
      .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
      .replace(/__([^_\n]+?)__/g, '$1')
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '$1')
      .replace(/`([^`\n]+?)`/g, '$1')
      .replace(/~~([^~\n]+?)~~/g, '$1')
  );
}
