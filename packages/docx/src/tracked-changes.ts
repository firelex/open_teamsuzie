import type { DocxFile } from './docx-file.js';
import type { XmlNode, XmlTree } from './types.js';

/**
 * Compatible with `@teamsuzie/docx-diff`'s `WordDiffOp` so callers can pipe
 * a paragraph diff straight in without a cross-package type dependency.
 * Defining locally keeps `@teamsuzie/docx` free-standing — apps that just
 * want to write tracked changes don't need to install the diff package.
 */
export interface WordDiffOp {
    kind: 'equal' | 'insert' | 'delete';
    text: string;
}

export interface RevisionAuthor {
    name: string;
    /** ISO 8601. Defaults to the editor's construction time. */
    date?: string;
}

/**
 * In-place editor for inserting tracked changes (`<w:ins>` / `<w:del>`)
 * into a `DocxFile`'s parsed `word/document.xml` tree. All operations
 * mutate the document in place and call `markDocumentDirty()` so the next
 * `save()` re-serializes.
 *
 * Scope (MVP):
 *
 * - **Body-level paragraphs only.** Paragraphs nested inside tables
 *   (`<w:tbl>` → `<w:tr>` → `<w:tc>` → `<w:p>`) are out of scope —
 *   `bodyParagraphCount()` and the indexed APIs see only direct
 *   `<w:body>` children. Table content support is a separate ticket.
 *
 * - **Modified paragraphs lose run formatting.** `applyParagraphDiff`
 *   replaces the paragraph's runs with a sequence of plain-text runs
 *   reflecting the diff. `<w:pPr>` (paragraph style, numbering, alignment)
 *   IS preserved, so a heading stays a heading. `<w:rPr>` (bold, italic,
 *   color, font) is dropped on modified paragraphs only — unchanged
 *   paragraphs and deleted paragraphs (which keep original runs, just
 *   wrapped in `<w:del>` with `<w:t>` rewritten to `<w:delText>`) are
 *   formatting-preserving.
 *
 * - **Paragraph-mark markers are emitted.** Inserted paragraphs carry a
 *   `<w:ins>` inside `<w:pPr>/<w:rPr>` to mark the paragraph break itself
 *   as new (without this, Word's accept-all merges the inserted
 *   paragraph into its neighbour). Deleted paragraphs carry the
 *   equivalent `<w:del>`.
 */
export class TrackedChangesEditor {
    private readonly file: DocxFile;
    private readonly author: string;
    private readonly date: string;
    private nextId: number;

    constructor(file: DocxFile, author: RevisionAuthor) {
        this.file = file;
        this.author = author.name;
        this.date = author.date ?? new Date().toISOString();
        this.nextId = computeNextRevisionId(file.document());
    }

    /** Number of body-level `<w:p>` children. Tables are not counted. */
    bodyParagraphCount(): number {
        return getBodyParagraphs(this.file.document()).length;
    }

    /**
     * Replace the body paragraph at `index` with runs reflecting the given
     * word-level diff. Returns the revision ids issued (one per insert/
     * delete op; equal ops don't allocate ids).
     *
     * Pass `opts.inheritFormatting = true` to preserve run-level
     * formatting on the modified paragraph. Two-tier heuristic:
     *
     * 1. **Run-splitting (preferred).** When the concatenation of
     *    existing-run text equals the concatenation of equal+delete op
     *    text — true for body paragraphs whose `<w:t>` content matches
     *    what the diff was computed against — split segments at op
     *    boundaries so each equal/delete sub-run keeps its EXACT source
     *    `<w:rPr>`. Mid-paragraph formatting variation (one bold word
     *    inside plain text, mixed sizes, etc.) survives.
     *
     * 2. **First-run fallback.** When the texts don't match (typically
     *    because mammoth-derived diff text adds list-marker prefixes
     *    that don't exist in `<w:t>`), fall back to copying just the
     *    first existing run's `<w:rPr>` onto every generated run. Keeps
     *    uniform paragraphs looking right; loses mid-paragraph variation.
     */
    applyParagraphDiff(
        index: number,
        ops: WordDiffOp[],
        opts?: { inheritFormatting?: boolean },
    ): number[] {
        const body = getBodyChildren(this.file.document());
        const paragraphIndices = bodyParagraphIndices(body);
        if (index < 0 || index >= paragraphIndices.length) {
            throw new Error(
                `paragraph index ${index} out of range (body has ${paragraphIndices.length} paragraphs)`,
            );
        }
        const pNode = body[paragraphIndices[index]];
        const pChildren = pNode['w:p'] as XmlNode[];
        const pPr = pChildren.find(isPPr);

        // Tier 1: flatten/reconstruct (per-char run preservation, accepted
        // view of pre-existing tracked changes, non-touched children
        // preserved at their original positions).
        if (opts?.inheritFormatting) {
            const flat = flattenParagraph(pChildren);
            const opsOriginalText = ops
                .filter((op) => op.kind !== 'insert')
                .map((op) => op.text)
                .join('');
            if (flat.runs.length > 0 && flat.paraText === opsOriginalText) {
                return this.applyParagraphDiffViaFlatten(pNode, flat, ops);
            }
        }

        // Tier 2: first-run-rPr fallback (or no formatting if disabled).
        const inheritedRPr = opts?.inheritFormatting
            ? extractFirstRunRPr(pChildren)
            : undefined;

        const newChildren: XmlNode[] = [];
        if (pPr) newChildren.push(pPr);
        const ids: number[] = [];
        for (const op of ops) {
            if (op.kind === 'equal') {
                if (op.text.length === 0) continue;
                newChildren.push(makeRun(op.text, false, inheritedRPr));
            } else if (op.kind === 'delete') {
                if (op.text.length === 0) continue;
                const id = this.allocId();
                ids.push(id);
                newChildren.push(
                    this.wrapInDel([makeRun(op.text, true, inheritedRPr)], id),
                );
            } else {
                if (op.text.length === 0) continue;
                const id = this.allocId();
                ids.push(id);
                newChildren.push(
                    this.wrapInIns([makeRun(op.text, false, inheritedRPr)], id),
                );
            }
        }
        pNode['w:p'] = newChildren;
        this.file.markDocumentDirty();
        return ids;
    }

    /**
     * Flatten/reconstruct implementation of applyParagraphDiff. Builds a
     * per-char map (paraText + charRun + run slots with childIndex/rPr)
     * across the paragraph's runs in *accepted view* (text inside
     * `<w:ins>` is included as if bare; `<w:del>` is excluded), then
     * walks the `WordDiffOp[]` with a paragraph-text cursor:
     *
     *  - `equal` op  → emit unwrapped runs grouped by source-run boundary
     *                  so each fragment keeps its source `<w:rPr>`.
     *  - `delete` op → emit a single `<w:del>` whose inner runs preserve
     *                  per-source-run formatting (text leaves rewritten
     *                  to `<w:delText>`).
     *  - `insert` op → emit a `<w:ins>` whose inner run inherits the
     *                  `<w:rPr>` of the run immediately preceding the
     *                  cursor (or following, if at paragraph start).
     *
     * The new run group only replaces the paragraph children that
     * correspond to *touched* runs — non-touched children (bookmarks,
     * `<w:sdt>`, section breaks, comments, anything that sits between
     * runs) stay at their original positions. `<w:del>` wrappers inside
     * the touched span are dropped (their content was excluded from
     * paraText, so removing the wrapper just accepts the prior deletion).
     */
    private applyParagraphDiffViaFlatten(
        pNode: XmlNode,
        flat: Flattened,
        ops: WordDiffOp[],
    ): number[] {
        const pChildren = pNode['w:p'] as XmlNode[];
        const ids: number[] = [];

        // First pass: walk ops to find the touched run-index span — every
        // run that contains a deleted char or sits adjacent to an insert
        // anchor counts as touched.
        let firstRun = flat.runs.length;
        let lastRun = -1;
        const trackRun = (r: number) => {
            if (r < firstRun) firstRun = r;
            if (r > lastRun) lastRun = r;
        };
        let probeCursor = 0;
        for (const op of ops) {
            if (op.kind === 'equal') {
                probeCursor += op.text.length;
            } else if (op.kind === 'delete') {
                for (let p = probeCursor; p < probeCursor + op.text.length; p++) {
                    trackRun(flat.charRun[p]);
                }
                probeCursor += op.text.length;
            } else {
                // Insert anchor: the run on either side of the cursor counts as
                // touched so we have a valid span to splice into.
                if (probeCursor > 0) {
                    trackRun(flat.charRun[probeCursor - 1]);
                }
                if (probeCursor < flat.paraText.length) {
                    trackRun(flat.charRun[probeCursor]);
                }
            }
        }
        if (firstRun > lastRun) {
            // Edits don't actually touch anything (e.g., empty ops list).
            // Nothing to do.
            return ids;
        }

        // The reconstructed run group only covers the touched-run span
        // [spanStart, spanEnd) — equal portions OUTSIDE the span are
        // already represented by the original (untouched) runs in
        // pChildren and would duplicate if we emitted them again.
        const spanStart = flat.runs[firstRun].paraStart;
        const spanEnd = flat.runs[lastRun].paraEnd;

        const newRunGroup: XmlNode[] = [];
        const emitFragments = (
            from: number,
            to: number,
            wrap: 'none' | 'del',
        ): XmlNode[] => {
            const fragments: XmlNode[] = [];
            let i = from;
            while (i < to) {
                const runIdx = flat.charRun[i];
                let j = i + 1;
                while (j < to && flat.charRun[j] === runIdx) j++;
                const slice = flat.paraText.slice(i, j);
                const rPr = flat.runs[runIdx].rPr ?? undefined;
                fragments.push(makeRun(slice, wrap === 'del', rPr));
                i = j;
            }
            return fragments;
        };

        let cursor = 0;
        for (const op of ops) {
            if (op.kind === 'equal') {
                if (op.text.length === 0) continue;
                const opStart = cursor;
                const opEnd = cursor + op.text.length;
                cursor = opEnd;
                const emitStart = Math.max(opStart, spanStart);
                const emitEnd = Math.min(opEnd, spanEnd);
                if (emitStart >= emitEnd) continue;
                for (const f of emitFragments(emitStart, emitEnd, 'none')) {
                    newRunGroup.push(f);
                }
            } else if (op.kind === 'delete') {
                if (op.text.length === 0) continue;
                // By construction, delete chars are inside [spanStart, spanEnd)
                // — the touched-span computation included every deleted char's
                // run.
                const id = this.allocId();
                ids.push(id);
                const inner = emitFragments(
                    cursor,
                    cursor + op.text.length,
                    'del',
                );
                newRunGroup.push(this.wrapInDel(inner, id));
                cursor += op.text.length;
            } else {
                // insert
                if (op.text.length === 0) continue;
                // Insert anchors are inside [spanStart, spanEnd] by
                // construction (the probe added adjacent runs to the span).
                if (cursor < spanStart || cursor > spanEnd) continue;
                const id = this.allocId();
                ids.push(id);
                let rPr: XmlNode | null = null;
                if (cursor > 0) {
                    rPr = flat.runs[flat.charRun[cursor - 1]].rPr;
                } else if (cursor < flat.paraText.length) {
                    rPr = flat.runs[flat.charRun[cursor]].rPr;
                }
                newRunGroup.push(
                    this.wrapInIns(
                        [makeRun(op.text, false, rPr ?? undefined)],
                        id,
                    ),
                );
            }
        }

        // Splice: replace just the touched-run children (and any `<w:del>`
        // wrappers inside that child-index range — their content was
        // excluded from paraText, so removing them accepts the prior
        // deletion). Non-touched children (bookmarks, `<w:sdt>`, etc.)
        // stay at their original positions.
        const startChildIdx = flat.runs[firstRun].childIndex;
        const endChildIdx = flat.runs[lastRun].childIndex;
        const droppedChildIdx = new Set<number>();
        for (let r = firstRun; r <= lastRun; r++) {
            droppedChildIdx.add(flat.runs[r].childIndex);
        }
        for (let i = startChildIdx; i <= endChildIdx; i++) {
            if (primaryTag(pChildren[i]) === 'w:del') {
                droppedChildIdx.add(i);
            }
        }

        const newChildren: XmlNode[] = [];
        for (let i = 0; i < pChildren.length; i++) {
            if (i === startChildIdx) {
                for (const n of newRunGroup) newChildren.push(n);
            }
            if (droppedChildIdx.has(i)) continue;
            newChildren.push(pChildren[i]);
        }
        pNode['w:p'] = newChildren;
        this.file.markDocumentDirty();
        return ids;
    }

    /**
     * Read the `<w:pPr>` of the body paragraph at `index`, returning a
     * deep clone so callers can pass it to `insertParagraph` without
     * accidentally aliasing the original. Useful for "inherit from
     * neighbour" composition flows (R-A → R-B redline pipeline).
     */
    getBodyParagraphPPr(index: number): XmlNode | null {
        const body = getBodyChildren(this.file.document());
        const paragraphIndices = bodyParagraphIndices(body);
        if (index < 0 || index >= paragraphIndices.length) return null;
        const pNode = body[paragraphIndices[index]];
        const pChildren = pNode['w:p'] as XmlNode[];
        const pPr = pChildren.find(isPPr);
        return pPr ? (cloneNode(pPr) ?? null) : null;
    }

    /**
     * Mark the body paragraph at `index` as deleted: wrap all run-like
     * children in `<w:del>` (rewriting `<w:t>` → `<w:delText>`) and add a
     * paragraph-mark deletion marker inside `<w:pPr>/<w:rPr>`. Word will
     * strike the paragraph through and, on accept-all, merge it into the
     * next paragraph.
     */
    deleteParagraph(index: number): number {
        const body = getBodyChildren(this.file.document());
        const paragraphIndices = bodyParagraphIndices(body);
        if (index < 0 || index >= paragraphIndices.length) {
            throw new Error(`paragraph index ${index} out of range`);
        }
        const id = this.allocId();
        const pNode = body[paragraphIndices[index]];
        const pChildren = pNode['w:p'] as XmlNode[];

        // Ensure pPr/rPr exists so we can hang the paragraph-mark del marker on it.
        const pPr = ensurePPr(pChildren);
        const rPr = ensureRPr(pPr);
        (rPr['w:rPr'] as XmlNode[]).push(this.makePMarkMarker('w:del', id));

        // Wrap each non-pPr child in <w:del>, rewriting w:t → w:delText
        // for any run text inside.
        const wrapped: XmlNode[] = [pPr];
        for (const child of pChildren) {
            if (isPPr(child)) continue;
            const rewritten = rewriteRunTextToDelText(child);
            wrapped.push(this.wrapInDel([rewritten], id));
        }
        pNode['w:p'] = wrapped;
        this.file.markDocumentDirty();
        return id;
    }

    /**
     * Insert a new paragraph after the body paragraph at `afterIndex`. Pass
     * `afterIndex = -1` to insert before the first body paragraph. The new
     * paragraph carries a paragraph-mark insertion marker on its `<w:pPr>`
     * and wraps its content run in `<w:ins>`. Optional `pPr` lets the caller
     * inherit paragraph style from a neighbour (or, in redline composition,
     * from the source-side paragraph in the right document); optional `rPr`
     * lets the caller carry the source's run formatting onto the inserted
     * content run.
     */
    insertParagraph(
        afterIndex: number,
        text: string,
        opts?: { pPr?: XmlNode; rPr?: XmlNode },
    ): number {
        const body = getBodyChildren(this.file.document());
        const paragraphIndices = bodyParagraphIndices(body);
        if (afterIndex < -1 || afterIndex >= paragraphIndices.length) {
            throw new Error(`afterIndex ${afterIndex} out of range`);
        }
        const id = this.allocId();
        const insertAtBodyIdx =
            afterIndex === -1
                ? paragraphIndices[0] ?? body.length
                : paragraphIndices[afterIndex] + 1;

        const pPr = cloneNode(opts?.pPr) ?? { 'w:pPr': [] };
        const rPr = ensureRPr(pPr);
        (rPr['w:rPr'] as XmlNode[]).push(this.makePMarkMarker('w:ins', id));

        const inheritedRPr = opts?.rPr ? cloneNode(opts.rPr) : undefined;

        const newP: XmlNode = {
            'w:p': [
                pPr,
                this.wrapInIns([makeRun(text, false, inheritedRPr)], id),
            ],
        };
        body.splice(insertAtBodyIdx, 0, newP);
        this.file.markDocumentDirty();
        return id;
    }

    private allocId(): number {
        const id = this.nextId;
        this.nextId += 1;
        return id;
    }

    private wrapInIns(children: XmlNode[], id: number): XmlNode {
        return {
            'w:ins': children,
            ':@': {
                '@_w:id': String(id),
                '@_w:author': this.author,
                '@_w:date': this.date,
            },
        };
    }

    private wrapInDel(children: XmlNode[], id: number): XmlNode {
        return {
            'w:del': children,
            ':@': {
                '@_w:id': String(id),
                '@_w:author': this.author,
                '@_w:date': this.date,
            },
        };
    }

    private makePMarkMarker(tag: 'w:ins' | 'w:del', id: number): XmlNode {
        return {
            [tag]: [],
            ':@': {
                '@_w:id': String(id),
                '@_w:author': this.author,
                '@_w:date': this.date,
            },
        };
    }
}

// ── Tree navigation helpers ─────────────────────────────────────────────

/**
 * Per-paragraph snapshot returned by `bodyParagraphInfos`. Provides the
 * paragraph's plain text (for diffing) plus deep-cloned `<w:pPr>` and
 * first-run `<w:rPr>` (for right-side inheritance in tracked-change
 * composition flows). The clones are safe to pass to
 * `TrackedChangesEditor.insertParagraph(opts.pPr / opts.rPr)` without
 * aliasing the source document's tree.
 */
export interface BodyParagraphInfo {
    /** Concatenated `<w:t>` text in accepted view (excludes `<w:del>`, includes `<w:ins>` content). */
    text: string;
    /** Deep clone of the paragraph's `<w:pPr>`, or null if it had none. */
    pPr: XmlNode | null;
    /** Deep clone of the first content run's `<w:rPr>`, or null if no run had rPr. */
    firstRunRPr: XmlNode | null;
}

/**
 * Walk every body `<w:p>` and return text + pPr + first-run-rPr per
 * paragraph (deep-cloned). The richer companion to `bodyParagraphTexts`
 * — use it when you intend to look up source-side formatting metadata
 * by paragraph index, e.g. `composeRedlineDocx` inheriting the right
 * document's paragraph style for inserted paragraphs.
 */
export function bodyParagraphInfos(file: {
    document: () => XmlTree;
}): BodyParagraphInfo[] {
    const tree = file.document();
    const body = getBodyChildren(tree);
    const out: BodyParagraphInfo[] = [];
    for (const child of body) {
        if (!('w:p' in child)) continue;
        const pChildren = (child['w:p'] ?? []) as XmlNode[];
        const pPrNode = pChildren.find((c) => 'w:pPr' in c);
        const firstRunRPrNode = extractFirstRunRPr(pChildren);
        out.push({
            text: extractParagraphText(child),
            pPr: pPrNode ? (cloneNode(pPrNode) ?? null) : null,
            firstRunRPr: firstRunRPrNode
                ? (cloneNode(firstRunRPrNode) ?? null)
                : null,
        });
    }
    return out;
}

/**
 * Extract the plain text of every body `<w:p>` in document order, returning
 * one string per paragraph (empty string for paragraphs with no text). Use
 * this when you intend to diff the document and feed the resulting edits
 * back through `TrackedChangesEditor` — the array indices line up
 * 1:1 with the editor's body-paragraph indices, which is critical for
 * reverse-pass mutation flows like `composeRedlineDocx`.
 *
 * Mammoth-derived markdown drops empty paragraphs (used in legal docs for
 * spacing), so feeding mammoth output into the diff produces indices that
 * don't match the editor's view. Going OOXML-direct avoids that drift.
 *
 * Pre-existing tracked changes are presented in "accepted view": text
 * inside `<w:ins>` is included, text inside `<w:del>` is skipped.
 * Non-text run children (`<w:tab>`, `<w:br>`, `<w:sym>`, fields, ...) are
 * ignored — their visual whitespace doesn't appear in the returned text,
 * so callers should expect the OOXML run-text concatenation to also
 * exclude them when aligning runs back to a diff (`applyParagraphDiff`'s
 * run-splitting handles this by falling back when the texts don't match).
 */
export function bodyParagraphTexts(file: { document: () => XmlTree }): string[] {
    const tree = file.document();
    const body = getBodyChildren(tree);
    const out: string[] = [];
    for (const child of body) {
        if (!('w:p' in child)) continue;
        out.push(extractParagraphText(child));
    }
    return out;
}

function extractParagraphText(pNode: XmlNode): string {
    const children = (pNode['w:p'] ?? []) as XmlNode[];
    let out = '';
    for (const child of children) {
        const tag = primaryTag(child);
        if (tag === 'w:r') {
            out += extractRunText(child);
        } else if (tag === 'w:ins') {
            // Accepted view: existing tracked-insert content is part of
            // the visible text.
            const insChildren = (child['w:ins'] ?? []) as XmlNode[];
            for (const inner of insChildren) {
                if (primaryTag(inner) === 'w:r') {
                    out += extractRunText(inner);
                }
            }
        }
        // w:del wrappers excluded — accepted view drops deleted text.
        // w:pPr, w:bookmarkStart/End, w:sdt, etc. carry no visible text.
    }
    return out;
}

function extractRunText(rNode: XmlNode): string {
    const runChildren = (rNode['w:r'] ?? []) as XmlNode[];
    let out = '';
    for (const c of runChildren) {
        if ('w:t' in c) {
            const t = c['w:t'];
            if (Array.isArray(t)) {
                for (const leaf of t) {
                    if (
                        leaf &&
                        typeof leaf === 'object' &&
                        '#text' in leaf &&
                        typeof (leaf as { '#text': unknown })['#text'] ===
                            'string'
                    ) {
                        out += (leaf as { '#text': string })['#text'];
                    }
                }
            }
        }
        // w:tab, w:br, w:sym, fields, etc. don't contribute to the text
        // stream used for diffing. (Word renders them as visible content,
        // but per-char alignment with diff text would break — the diff
        // doesn't see them either.)
    }
    return out;
}

export function getBodyChildren(tree: XmlTree): XmlNode[] {
    const docNode = tree.find((n) => 'w:document' in n);
    if (!docNode) throw new Error('w:document not found in tree');
    const docChildren = docNode['w:document'] as XmlNode[];
    const body = docChildren.find((n) => 'w:body' in n);
    if (!body) throw new Error('w:body not found in document');
    return body['w:body'] as XmlNode[];
}

/** Indices of `<w:p>` direct children of `<w:body>`, in document order. */
function bodyParagraphIndices(body: XmlNode[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < body.length; i++) {
        if ('w:p' in body[i]) out.push(i);
    }
    return out;
}

function getBodyParagraphs(tree: XmlTree): XmlNode[] {
    const body = getBodyChildren(tree);
    return body.filter((n) => 'w:p' in n);
}

function isPPr(n: XmlNode): boolean {
    return 'w:pPr' in n;
}

function ensurePPr(pChildren: XmlNode[]): XmlNode {
    const existing = pChildren.find(isPPr);
    if (existing) return existing;
    const pPr: XmlNode = { 'w:pPr': [] };
    pChildren.unshift(pPr);
    return pPr;
}

function ensureRPr(pPr: XmlNode): XmlNode {
    const children = pPr['w:pPr'] as XmlNode[];
    const existing = children.find((c) => 'w:rPr' in c);
    if (existing) return existing;
    const rPr: XmlNode = { 'w:rPr': [] };
    children.push(rPr);
    return rPr;
}

function makeRun(
    text: string,
    isDeleted: boolean,
    inheritedRPr?: XmlNode,
): XmlNode {
    const tag = isDeleted ? 'w:delText' : 'w:t';
    const runChildren: XmlNode[] = [];
    if (inheritedRPr) {
        const cloned = cloneNode(inheritedRPr);
        if (cloned) runChildren.push(cloned);
    }
    runChildren.push({
        [tag]: [{ '#text': text }],
        ':@': { '@_xml:space': 'preserve' },
    });
    return { 'w:r': runChildren };
}

/**
 * Find the first `<w:r>` in the paragraph's children and return its
 * `<w:rPr>` element (or undefined if either is missing). Used by
 * `applyParagraphDiff(opts.inheritFormatting)` as a first-run fallback
 * when run-splitting can't align text exactly.
 */
function extractFirstRunRPr(pChildren: XmlNode[]): XmlNode | undefined {
    for (const c of pChildren) {
        if (!('w:r' in c)) continue;
        const runChildren = c['w:r'] as XmlNode[];
        const rPr = runChildren.find((rc) => 'w:rPr' in rc);
        if (rPr) return rPr;
    }
    return undefined;
}

/**
 * Per-character map from paragraph-text offset back to the source run.
 * `charRun[i]` is the index in `runs` for the run that contributed
 * `paraText[i]`. Run slots remember the original child-array index of
 * their containing element (the `<w:r>` itself, or the surrounding
 * `<w:ins>` wrapper when text was extracted in accepted view) so
 * reconstruction can locate the touched-child-span and splice the new
 * run group in at the right position.
 */
interface RunSlot {
    /** Index in paragraph.children where this run (or its wrapping w:ins) lives. */
    childIndex: number;
    /** Source `<w:rPr>`, not cloned — copied during run construction via cloneNode in makeRun. */
    rPr: XmlNode | null;
    /** First paraText offset that came from this run (inclusive). Empty runs have paraStart === paraEnd. */
    paraStart: number;
    /** Last paraText offset + 1 (exclusive). */
    paraEnd: number;
}

interface Flattened {
    paraText: string;
    /** Index into `runs` per paraText character. Same length as paraText. */
    charRun: Int32Array;
    runs: RunSlot[];
}

/**
 * Build a flattened, accepted-view representation of a paragraph.
 *
 *   - Top-level `<w:r>` children contribute their text and rPr directly.
 *   - Top-level `<w:ins>` wrapper children expose their inner `<w:r>`
 *     content as if bare (accepted view); the slot's `childIndex` points
 *     at the wrapper so reconstruction can drop it whole when the run
 *     is touched.
 *   - Top-level `<w:del>` wrapper children are skipped — their content
 *     is excluded from paraText (accepted view), so the diff input
 *     never sees that text.
 *   - Non-text run children (`<w:tab>`, `<w:br>`, `<w:sym>`, fields)
 *     don't contribute to paraText. If a run contains them mixed with
 *     `<w:t>`, the run still appears with its text-only content; the
 *     caller's text-alignment check (paraText vs ops original text)
 *     decides whether reconstruction is safe.
 */
function flattenParagraph(pChildren: XmlNode[]): Flattened {
    const runs: RunSlot[] = [];
    let paraText = '';
    const charRunArr: number[] = [];

    const pushRun = (rNode: XmlNode, childIdx: number) => {
        const rChildren = (rNode['w:r'] ?? []) as XmlNode[];
        const rPr = rChildren.find((c) => 'w:rPr' in c) ?? null;
        let runText = '';
        for (const c of rChildren) {
            if ('w:t' in c) {
                const t = c['w:t'];
                if (Array.isArray(t)) {
                    for (const leaf of t) {
                        if (
                            leaf &&
                            typeof leaf === 'object' &&
                            '#text' in leaf &&
                            typeof (leaf as { '#text': unknown })['#text'] ===
                                'string'
                        ) {
                            runText += (leaf as { '#text': string })['#text'];
                        }
                    }
                }
            }
        }
        const slotIdx = runs.length;
        const paraStart = paraText.length;
        runs.push({
            childIndex: childIdx,
            rPr,
            paraStart,
            paraEnd: paraStart + runText.length,
        });
        paraText += runText;
        for (let i = 0; i < runText.length; i++) charRunArr.push(slotIdx);
    };

    for (let ci = 0; ci < pChildren.length; ci++) {
        const child = pChildren[ci];
        const tag = primaryTag(child);
        if (tag === 'w:r') {
            pushRun(child, ci);
        } else if (tag === 'w:ins') {
            const insChildren = (child['w:ins'] ?? []) as XmlNode[];
            for (const inner of insChildren) {
                if (primaryTag(inner) === 'w:r') {
                    pushRun(inner, ci);
                }
            }
        }
        // w:del / w:pPr / w:bookmarkStart / w:sdt / w:sectPr / etc.
        // — ignored for paraText purposes; preserved at their original
        // child positions during reconstruction.
    }

    return {
        paraText,
        charRun: Int32Array.from(charRunArr),
        runs,
    };
}

/**
 * Recursively rewrite any `<w:t>` text leaf inside a node tree to
 * `<w:delText>` (for use when wrapping existing runs in `<w:del>`). Other
 * elements pass through untouched. Mutates the input.
 */
function rewriteRunTextToDelText(node: XmlNode): XmlNode {
    for (const key of Object.keys(node)) {
        if (key === ':@') continue;
        if (key === 'w:t') {
            // Rename the key to w:delText, preserving the text leaf children.
            const value = node[key];
            delete node[key];
            (node as Record<string, unknown>)['w:delText'] = value;
            continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && typeof child === 'object') {
                    rewriteRunTextToDelText(child as XmlNode);
                }
            }
        }
    }
    return node;
}

function cloneNode<T>(node: T | undefined): T | undefined {
    return node === undefined ? undefined : (JSON.parse(JSON.stringify(node)) as T);
}

// ── Revision id allocation ──────────────────────────────────────────────

/**
 * Walk the tree finding the maximum existing `w:id` attribute on any
 * `<w:ins>` / `<w:del>` element, and return one above it. New revisions
 * always allocate above whatever's already in the document so we don't
 * collide with prior tracked changes.
 */
export function computeNextRevisionId(tree: XmlTree): number {
    let max = 0;
    walk(tree, (node) => {
        const tag = primaryTag(node);
        if (tag !== 'w:ins' && tag !== 'w:del') return;
        const attrs = node[':@'];
        if (!attrs) return;
        const idStr = attrs['@_w:id'];
        if (typeof idStr === 'string') {
            const n = Number.parseInt(idStr, 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    });
    return max + 1;
}

export function primaryTag(node: XmlNode): string | null {
    for (const key of Object.keys(node)) {
        if (key === ':@') continue;
        return key;
    }
    return null;
}

export function walk(tree: XmlTree | XmlNode[], visit: (n: XmlNode) => void): void {
    for (const node of tree) {
        visit(node);
        const tag = primaryTag(node);
        if (!tag) continue;
        const value = node[tag];
        if (Array.isArray(value)) {
            walk(value as XmlNode[], visit);
        }
    }
}
