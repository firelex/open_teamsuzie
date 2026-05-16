/**
 * Redline preview extraction.
 *
 * Walks a DOCX's main-document paragraphs, including table-cell
 * paragraphs, and emits a per-paragraph view with each run tagged as
 * equal / insert / delete + carrying its `w:id` revision id when wrapped.
 * Consumers use this to render inline tracked changes alongside
 * accept/reject cards, with the revision id as the cross-reference.
 *
 * Note on naming: `RedlineRun` and `RedlineParagraph` here are
 * structurally identical to the same-named types exported by
 * `@teamsuzie/ui`. Apps consume one or the other depending on whether
 * they're working in server (docx) or client (ui) code; the shapes line
 * up so values flow through without conversion.
 */
import { loadDocx } from './docx-file.js';
import type { XmlNode, XmlTree } from './types.js';

export interface RedlineRun {
  kind: 'equal' | 'insert' | 'delete';
  text: string;
  /** OOXML `w:id` of the wrapping `<w:ins>` / `<w:del>`. Absent for `equal` runs. */
  revisionId?: number;
}

export interface RedlineParagraph {
  /** Body-paragraph index — matches `bodyParagraphTexts(file)[index]`. */
  index: number;
  runs: RedlineRun[];
}

/**
 * Locate the body-paragraph index that an applied content-keyed edit
 * landed in. Replays the same disambiguation `applyContentKeyedEdits`
 * uses (find + context_before + context_after on lightly-normalized
 * paragraph text) against the pre-mutation paragraph snapshot. Returns
 * -1 when no unique match is found — callers treat -1 as "card has no
 * inline anchor".
 *
 * Kept separate from `extractRedlineParagraphs` because it operates on
 * the ORIGINAL paragraph texts (snapshotted before the editor mutates
 * the tree), while the redline view runs against the MUTATED tree.
 */
export function findEditParagraphIndex(
  paragraphTexts: string[],
  find: string,
  contextBefore: string,
  contextAfter: string,
): number {
  const normFind = normalize(find);
  const normBefore = normalize(contextBefore);
  const normAfter = normalize(contextAfter);
  const matches: number[] = [];
  for (let i = 0; i < paragraphTexts.length; i++) {
    const normPara = normalize(paragraphTexts[i]);
    const positions =
      normFind.length === 0
        ? Array.from({ length: normPara.length + 1 }, (_, k) => k)
        : indexAll(normPara, normFind);
    for (const p of positions) {
      const ctxBeforeStart = p - normBefore.length;
      const ctxAfterEnd = p + normFind.length + normAfter.length;
      if (ctxBeforeStart < 0) continue;
      if (ctxAfterEnd > normPara.length) continue;
      if (
        normBefore.length > 0 &&
        normPara.slice(ctxBeforeStart, p) !== normBefore
      )
        continue;
      if (
        normAfter.length > 0 &&
        normPara.slice(p + normFind.length, ctxAfterEnd) !== normAfter
      )
        continue;
      matches.push(i);
    }
  }
  return matches.length === 1 ? matches[0] : -1;
}

function indexAll(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let i = 0;
  while (i <= haystack.length - needle.length) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

/**
 * Read a DOCX's main-document paragraphs and emit one `RedlineParagraph`
 * per `<w:p>`. Each paragraph's runs are flattened: `<w:r>` content
 * stays `equal`; runs inside `<w:ins>` become `insert` (carrying the
 * wrapper's `w:id`); runs inside `<w:del>` become `delete`. Empty
 * paragraphs and paragraphs with no visible text round-trip as zero-run
 * entries — the client renders those as a blank line so the inline
 * view's paragraph indices align with the cards' `paragraph_index`.
 */
export function extractRedlineParagraphs(
  bytes: Uint8Array | Buffer,
): RedlineParagraph[] {
  const file = loadDocx(bytes);
  const tree = file.document();
  const body = getBody(tree);
  const out: RedlineParagraph[] = [];
  const paragraphs = collectParagraphs(body);
  for (let i = 0; i < paragraphs.length; i++) {
    const runs: RedlineRun[] = [];
    walkParagraphChildren(
      paragraphs[i]['w:p'] as XmlNode[],
      'equal',
      undefined,
      runs,
    );
    out.push({ index: i, runs: coalesceRuns(runs) });
  }
  return out;
}

function walkParagraphChildren(
  children: XmlNode[],
  inheritedKind: RedlineRun['kind'],
  inheritedRevisionId: number | undefined,
  out: RedlineRun[],
): void {
  for (const c of children) {
    const tag = primary(c);
    if (tag === 'w:r') {
      const text = extractRunText(c, inheritedKind === 'delete');
      if (text.length > 0) {
        const run: RedlineRun = { kind: inheritedKind, text };
        if (inheritedRevisionId !== undefined) run.revisionId = inheritedRevisionId;
        out.push(run);
      }
    } else if (tag === 'w:ins' || tag === 'w:del') {
      const id = readId(c);
      const kind: RedlineRun['kind'] = tag === 'w:ins' ? 'insert' : 'delete';
      const inner = (c[tag] ?? []) as XmlNode[];
      walkParagraphChildren(inner, kind, id ?? inheritedRevisionId, out);
    }
    // w:pPr, w:bookmarkStart/End, w:sdt — no visible text contribution.
  }
}

function extractRunText(rNode: XmlNode, isDeleted: boolean): string {
  const runChildren = (rNode['w:r'] ?? []) as XmlNode[];
  let out = '';
  for (const child of runChildren) {
    const textKey = isDeleted ? 'w:delText' : 'w:t';
    if (textKey in child) {
      const t = child[textKey];
      if (Array.isArray(t)) {
        for (const leaf of t) {
          if (
            leaf &&
            typeof leaf === 'object' &&
            '#text' in leaf &&
            typeof (leaf as { '#text': unknown })['#text'] === 'string'
          ) {
            out += (leaf as { '#text': string })['#text'];
          }
        }
      }
    } else if (!isDeleted && 'w:delText' in child) {
      // Accepted-view fallthrough: a run inside <w:ins> may carry <w:t>
      // (normal) but we only branch on isDeleted, so this never fires for
      // ins runs. Leaving the explicit branch documents the asymmetry.
    }
  }
  return out;
}

function coalesceRuns(runs: RedlineRun[]): RedlineRun[] {
  const out: RedlineRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === r.kind &&
      last.revisionId === r.revisionId
    ) {
      last.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function getBody(tree: XmlTree): XmlNode[] {
  const docNode = tree.find((n) => 'w:document' in n);
  if (!docNode) throw new Error('w:document not found in tree');
  const docChildren = docNode['w:document'] as XmlNode[];
  const body = docChildren.find((n) => 'w:body' in n);
  if (!body) throw new Error('w:body not found in document');
  return body['w:body'] as XmlNode[];
}

function collectParagraphs(nodes: XmlNode[]): XmlNode[] {
  const out: XmlNode[] = [];
  const visit = (children: XmlNode[]) => {
    for (const node of children) {
      if (!node || typeof node !== 'object') continue;
      if ('w:p' in node) {
        out.push(node);
        continue;
      }
      const tag = primary(node);
      if (!tag) continue;
      const value = node[tag];
      if (Array.isArray(value)) visit(value as XmlNode[]);
    }
  };
  visit(nodes);
  return out;
}

function primary(node: XmlNode): string | null {
  for (const k of Object.keys(node)) {
    if (k !== ':@' && k !== '#text') return k;
  }
  return null;
}

function readId(node: XmlNode): number | undefined {
  const attrs = node[':@'];
  if (!attrs) return undefined;
  const v = attrs['@_w:id'];
  if (typeof v !== 'string') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function normalize(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/​/g, '');
}
