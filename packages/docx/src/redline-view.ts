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
  /** True when the run's `<w:rPr>` carries `<w:b/>` (without `w:val="0"`/`"false"`). Omitted when absent — keeps the wire payload tight. */
  bold?: boolean;
  /** True when the run's `<w:rPr>` carries `<w:i/>` (without `w:val="0"`/`"false"`). Omitted when absent. */
  italic?: boolean;
}

/**
 * Paragraph-level structural style mapped from `<w:pStyle w:val="..."/>`.
 * We only surface heading levels 1–3; deeper levels and unrecognized
 * style names fall back to `'normal'` because that's all the redline
 * chrome renders.
 */
export type RedlineParagraphStyle = 'heading1' | 'heading2' | 'heading3' | 'normal';

export interface RedlineParagraph {
  /** Body-paragraph index — matches `bodyParagraphTexts(file)[index]`. */
  index: number;
  runs: RedlineRun[];
  /** Paragraph style derived from `<w:pPr><w:pStyle w:val="..."/>`. Omitted (treated as `'normal'`) when absent. */
  style?: RedlineParagraphStyle;
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
    const pChildren = paragraphs[i]['w:p'] as XmlNode[];
    const runs: RedlineRun[] = [];
    walkParagraphChildren(pChildren, 'equal', undefined, runs);
    const style = extractParagraphStyle(pChildren);
    const para: RedlineParagraph = { index: i, runs: coalesceRuns(runs) };
    if (style !== 'normal') para.style = style;
    out.push(para);
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
        const { bold, italic } = extractRunFormatting(c);
        if (bold) run.bold = true;
        if (italic) run.italic = true;
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

/**
 * Inspect a `<w:r>` element's `<w:rPr>` child for direct `<w:b/>` and
 * `<w:i/>` formatting. We do NOT resolve style-table inheritance from
 * `styles.xml` — only direct rPr is honored, which matches the
 * markitdown → DOCX case (every bold run gets an explicit `<w:b/>`).
 * If a theme-based bold ever shows up in the wild we'll revisit.
 *
 * OOXML allows `<w:b w:val="0"/>` (or `"false"`) to disable bold even
 * when a parent style enables it — we treat those as "not bold" so the
 * renderer doesn't over-bold. Any other `w:val` (including absent) is
 * treated as enabled.
 */
function extractRunFormatting(rNode: XmlNode): {
  bold: boolean;
  italic: boolean;
} {
  const runChildren = (rNode['w:r'] ?? []) as XmlNode[];
  const rPrNode = runChildren.find((c) => 'w:rPr' in c);
  if (!rPrNode) return { bold: false, italic: false };
  const rPrChildren = (rPrNode['w:rPr'] ?? []) as XmlNode[];
  let bold = false;
  let italic = false;
  for (const c of rPrChildren) {
    const tag = primary(c);
    if (tag === 'w:b' && readToggle(c) !== false) bold = true;
    else if (tag === 'w:i' && readToggle(c) !== false) italic = true;
  }
  return { bold, italic };
}

/**
 * Read an OOXML toggle attribute (`w:val` on `<w:b>`, `<w:i>`, etc.).
 * Returns `false` only when `w:val="0"` or `"false"`; absence of the
 * attribute means "enabled" (the typical case for `<w:b/>`).
 */
function readToggle(node: XmlNode): boolean | undefined {
  const attrs = node[':@'];
  if (!attrs) return undefined;
  const v = attrs['@_w:val'];
  if (typeof v !== 'string') return undefined;
  if (v === '0' || v.toLowerCase() === 'false') return false;
  return true;
}

/**
 * Read `<w:pPr><w:pStyle w:val="..."/></w:pPr>` and map the style id to
 * a `RedlineParagraphStyle`. Matching is case-insensitive and tolerates
 * dashes/spaces between "heading" and the level, so DOCX exports that
 * use `"Heading2"`, `"heading 2"`, or `"heading-2"` all map to the same
 * bucket. Anything that isn't a heading 1/2/3 falls back to `'normal'`.
 */
function extractParagraphStyle(pChildren: XmlNode[]): RedlineParagraphStyle {
  const pPrNode = pChildren.find((c) => 'w:pPr' in c);
  if (!pPrNode) return 'normal';
  const pPrChildren = (pPrNode['w:pPr'] ?? []) as XmlNode[];
  const pStyleNode = pPrChildren.find((c) => 'w:pStyle' in c);
  if (!pStyleNode) return 'normal';
  const attrs = pStyleNode[':@'];
  if (!attrs) return 'normal';
  const val = attrs['@_w:val'];
  if (typeof val !== 'string') return 'normal';
  const normalized = val.toLowerCase().replace(/[\s-]+/g, '');
  if (normalized === 'heading1') return 'heading1';
  if (normalized === 'heading2') return 'heading2';
  if (normalized === 'heading3') return 'heading3';
  return 'normal';
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
      last.revisionId === r.revisionId &&
      !!last.bold === !!r.bold &&
      !!last.italic === !!r.italic
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
