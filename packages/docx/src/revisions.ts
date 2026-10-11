import type { DocxFile } from './docx-file.js';
import type { XmlNode, XmlTree } from './types.js';
import { getBodyChildren, primaryTag, walk } from './tracked-changes.js';

export interface Revision {
    id: number;
    /**
     * `'ins'` / `'del'` are content-wrapping revisions (the element wraps
     * runs whose insertion or deletion is being tracked).
     * `'paragraph-mark-ins'` / `'paragraph-mark-del'` are paragraph-mark
     * revisions (the marker lives inside `<w:pPr>/<w:rPr>` and tracks the
     * paragraph break itself, not any content).
     */
    type: 'ins' | 'del' | 'paragraph-mark-ins' | 'paragraph-mark-del';
    author: string;
    date: string;
}

/** Enumerate every tracked change in `word/document.xml`. */
export function listRevisions(file: DocxFile): Revision[] {
    const tree = file.document();
    const out: Revision[] = [];
    const seen = new Set<string>(); // id+type dedupe (paragraph-mark + content share id)

    walkContext(tree, (node, ctx) => {
        const tag = primaryTag(node);
        if (tag !== 'w:ins' && tag !== 'w:del') return;
        const attrs = node[':@'];
        if (!attrs) return;
        const idStr = attrs['@_w:id'];
        if (typeof idStr !== 'string') return;
        const id = Number.parseInt(idStr, 10);
        if (!Number.isFinite(id)) return;
        const author = attrs['@_w:author'] ?? '';
        const date = attrs['@_w:date'] ?? '';
        const isPMark = ctx.insideRPrInsidePPr;
        const type: Revision['type'] = isPMark
            ? tag === 'w:ins'
                ? 'paragraph-mark-ins'
                : 'paragraph-mark-del'
            : tag === 'w:ins'
              ? 'ins'
              : 'del';
        const key = `${id}:${type}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ id, type, author, date });
    });
    return out;
}

export interface AcceptRejectOptions {
    /** When true (default), `markDocumentDirty()` is called so the next save re-emits. */
    markDirty?: boolean;
}

/**
 * Accept a revision by id.
 *
 *   - `ins` (content) → unwrap: replace the `<w:ins>` element with its
 *     children, keeping the inserted runs as ordinary content.
 *   - `del` (content) → drop: remove the `<w:del>` element entirely so
 *     the deleted content is gone.
 *   - `paragraph-mark-ins` → drop the marker; paragraph break stays.
 *   - `paragraph-mark-del` → drop the marker AND merge the host paragraph
 *     with the next paragraph (the deletion of a paragraph break joins
 *     two paragraphs into one).
 *
 * Touching every paragraph-mark for the same `w:id` happens automatically:
 * Word emits the paragraph-mark `<w:ins>`/`<w:del>` *and* the content
 * wrapper with the same id. Both get resolved in one pass.
 */
export function acceptRevision(
    file: DocxFile,
    id: number,
    opts: AcceptRejectOptions = {},
): boolean {
    return resolve(file, id, 'accept', opts);
}

/**
 * Reject a revision by id.
 *
 *   - `ins` (content) → drop: remove the `<w:ins>` element entirely.
 *   - `del` (content) → unwrap and restore `<w:t>` (rewrite `<w:delText>`
 *     back) so the content reappears as live text.
 *   - `paragraph-mark-ins` → drop the marker AND merge with next
 *     paragraph (the inserted paragraph break is being undone).
 *   - `paragraph-mark-del` → drop the marker; paragraph break stays.
 */
export function rejectRevision(
    file: DocxFile,
    id: number,
    opts: AcceptRejectOptions = {},
): boolean {
    return resolve(file, id, 'reject', opts);
}

export function acceptAllRevisions(file: DocxFile): number {
    return resolveAll(file, 'accept');
}

export function rejectAllRevisions(file: DocxFile): number {
    return resolveAll(file, 'reject');
}

// ── Implementation ──────────────────────────────────────────────────────

type Action = 'accept' | 'reject';

function resolveAll(file: DocxFile, action: Action): number {
    const ids = new Set<number>();
    for (const r of listRevisions(file)) ids.add(r.id);
    let count = 0;
    for (const id of ids) {
        if (resolve(file, id, action, { markDirty: false })) count++;
    }
    if (count > 0) file.markDocumentDirty();
    return count;
}

function resolve(
    file: DocxFile,
    id: number,
    action: Action,
    opts: AcceptRejectOptions,
): boolean {
    const tree = file.document();
    const body = getBodyChildren(tree);
    let foundAny = false;

    // Walk every paragraph — top-level body paragraphs and paragraphs in
    // table cells or other containers — and note the ones whose paragraph
    // mark carries an `id`-matching `<w:ins>`/`<w:del>`. Resolve content
    // wrappers in place. Paragraph-mark merges happen after the walk so we
    // don't invalidate indices mid-traversal; each merge stays inside the
    // paragraph's own container (body, table cell, ...).
    const pMarksToMergeWithNext = new Map<XmlNode[], number[]>();

    function visitParagraph(p: XmlNode, container: XmlNode[], index: number) {
        const pChildren = p['w:p'] as XmlNode[];
        const pPr = pChildren.find((c) => 'w:pPr' in c);
        let paragraphMarkType: 'ins' | 'del' | null = null;
        if (pPr) {
            const rPr = (pPr['w:pPr'] as XmlNode[]).find((c) => 'w:rPr' in c);
            if (rPr) {
                const rPrChildren = rPr['w:rPr'] as XmlNode[];
                for (let i = rPrChildren.length - 1; i >= 0; i--) {
                    const c = rPrChildren[i];
                    const tag = primaryTag(c);
                    if (tag !== 'w:ins' && tag !== 'w:del') continue;
                    const cId = attrId(c);
                    if (cId !== id) continue;
                    paragraphMarkType = tag === 'w:ins' ? 'ins' : 'del';
                    rPrChildren.splice(i, 1);
                    foundAny = true;
                }
            }
        }
        // Paragraph-mark accept/reject semantics:
        //   accept-ins  → marker gone, paragraph stays.
        //   accept-del  → marker gone + merge with next paragraph.
        //   reject-ins  → marker gone + merge with next paragraph.
        //   reject-del  → marker gone, paragraph stays.
        if (
            (paragraphMarkType === 'ins' && action === 'reject') ||
            (paragraphMarkType === 'del' && action === 'accept')
        ) {
            const list = pMarksToMergeWithNext.get(container) ?? [];
            list.push(index);
            pMarksToMergeWithNext.set(container, list);
        }
        // Resolve content wrappers anywhere in the paragraph.
        if (resolveContentWrappersIn(pChildren, id, action)) foundAny = true;
    }

    visitParagraphsIn(body, visitParagraph);

    // Merge from the back of each container so earlier indices stay valid.
    for (const [container, indexes] of pMarksToMergeWithNext) {
        indexes.sort((a, b) => b - a);
        for (const index of indexes) mergeParagraphWithNext(container, index);
    }

    if (foundAny && opts.markDirty !== false) {
        file.markDocumentDirty();
    }
    return foundAny;
}

function attrId(node: XmlNode): number | null {
    const attrs = node[':@'];
    if (!attrs) return null;
    const v = attrs['@_w:id'];
    if (typeof v !== 'string') return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
}

/**
 * Walk the children array, resolving any `<w:ins>` / `<w:del>` elements at
 * any depth that match `id`. Mutates in place. Returns true if anything
 * was changed.
 */
function resolveContentWrappersIn(
    children: XmlNode[],
    id: number,
    action: Action,
): boolean {
    let changed = false;
    for (let i = children.length - 1; i >= 0; i--) {
        const node = children[i];
        const tag = primaryTag(node);
        if (tag === 'w:ins' || tag === 'w:del') {
            // Skip paragraph-mark markers (they live inside w:rPr inside w:pPr —
            // not at this level for content wrappers). The walk into nested
            // structures below will pass through them when present.
            const cId = attrId(node);
            if (cId === id) {
                if (tag === 'w:ins') {
                    if (action === 'accept') {
                        // Unwrap: replace this node with its children.
                        const inner = (node['w:ins'] as XmlNode[]) ?? [];
                        children.splice(i, 1, ...inner);
                    } else {
                        // Reject: drop entirely.
                        children.splice(i, 1);
                    }
                } else {
                    if (action === 'accept') {
                        // Drop entirely.
                        children.splice(i, 1);
                    } else {
                        // Unwrap and rewrite delText → t.
                        const inner = (node['w:del'] as XmlNode[]) ?? [];
                        for (const c of inner) rewriteDelTextToText(c);
                        children.splice(i, 1, ...inner);
                    }
                }
                changed = true;
                continue;
            }
        }
        // Recurse into children of this node (skip text leaves and `:@`).
        if (tag) {
            const value = node[tag];
            if (Array.isArray(value)) {
                if (resolveContentWrappersIn(value as XmlNode[], id, action)) {
                    changed = true;
                }
            }
        }
    }
    return changed;
}

function rewriteDelTextToText(node: XmlNode): XmlNode {
    for (const key of Object.keys(node)) {
        if (key === ':@') continue;
        if (key === 'w:delText') {
            const value = node[key];
            delete node[key];
            (node as Record<string, unknown>)['w:t'] = value;
            continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
            for (const c of value) {
                if (c && typeof c === 'object') rewriteDelTextToText(c as XmlNode);
            }
        }
    }
    return node;
}

/**
 * Call `visit` for every `<w:p>` under `nodes` (body paragraphs and
 * paragraphs inside tables, cells, content controls, ...), with the array
 * that holds it and its index there. Does not descend into paragraphs, so
 * paragraphs inside text boxes are not visited separately (content
 * wrappers inside them are still resolved as part of their host
 * paragraph).
 */
function visitParagraphsIn(
    nodes: XmlNode[],
    visit: (p: XmlNode, container: XmlNode[], index: number) => void,
): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || typeof node !== 'object') continue;
        if ('w:p' in node) {
            visit(node, nodes, i);
            continue;
        }
        const tag = primaryTag(node);
        if (!tag) continue;
        const value = node[tag];
        if (Array.isArray(value)) visitParagraphsIn(value as XmlNode[], visit);
    }
}

/**
 * Merge the paragraph at `index` of `container` with the next paragraph in
 * the same container: concatenate the second paragraph's content children
 * into the first, then drop the second. Skips if there's no following
 * paragraph in the container (the last paragraph of the body or of a
 * table cell; nothing to merge with).
 *
 * The merged paragraph keeps the first paragraph's properties (`<w:pPr>`).
 * Its paragraph mark is the second paragraph's mark, though — the first
 * one is the break being removed — so any revision markers still pending
 * on the second paragraph's mark (`<w:pPr>/<w:rPr>/<w:ins|w:del>`) replace
 * whatever is left on the first's. Resolving those revisions later then
 * merges again, which is what makes runs of adjacent deleted (accept) or
 * inserted (reject) paragraphs disappear completely.
 */
function mergeParagraphWithNext(container: XmlNode[], index: number): void {
    const first = container[index];
    if (!first || !('w:p' in first)) return;
    // Find the next w:p (skipping non-paragraph nodes like sectPr, tables).
    let nextIdx = -1;
    for (let i = index + 1; i < container.length; i++) {
        if ('w:p' in container[i]) {
            nextIdx = i;
            break;
        }
    }
    if (nextIdx === -1) return;
    const second = container[nextIdx];
    const firstChildren = first['w:p'] as XmlNode[];
    const secondChildren = second['w:p'] as XmlNode[];

    const carried = paragraphMarkMarkers(secondChildren);
    const firstMarkRPr = markRPrOf(firstChildren);
    if (firstMarkRPr) {
        const rPrChildren = firstMarkRPr['w:rPr'] as XmlNode[];
        for (let i = rPrChildren.length - 1; i >= 0; i--) {
            const tag = primaryTag(rPrChildren[i]);
            if (tag === 'w:ins' || tag === 'w:del') rPrChildren.splice(i, 1);
        }
    }
    if (carried.length > 0) {
        const rPr = firstMarkRPr ?? ensureMarkRPr(firstChildren);
        // Schema order puts the mark's ins/del first inside <w:rPr>.
        (rPr['w:rPr'] as XmlNode[]).unshift(...carried);
    }

    // Take all non-pPr children from the second and append to the first.
    for (const c of secondChildren) {
        if (!('w:pPr' in c)) firstChildren.push(c);
    }
    container.splice(nextIdx, 1);
}

/** The paragraph mark's `<w:pPr>/<w:rPr>` node, if present. */
function markRPrOf(pChildren: XmlNode[]): XmlNode | undefined {
    const pPr = pChildren.find((c) => 'w:pPr' in c);
    if (!pPr) return undefined;
    return (pPr['w:pPr'] as XmlNode[]).find((c) => 'w:rPr' in c);
}

/** The paragraph mark's pending `<w:ins>`/`<w:del>` markers, in order. */
function paragraphMarkMarkers(pChildren: XmlNode[]): XmlNode[] {
    const rPr = markRPrOf(pChildren);
    if (!rPr) return [];
    return (rPr['w:rPr'] as XmlNode[]).filter((c) => {
        const tag = primaryTag(c);
        return tag === 'w:ins' || tag === 'w:del';
    });
}

function ensureMarkRPr(pChildren: XmlNode[]): XmlNode {
    let pPr = pChildren.find((c) => 'w:pPr' in c);
    if (!pPr) {
        pPr = { 'w:pPr': [] };
        pChildren.unshift(pPr);
    }
    const pPrChildren = pPr['w:pPr'] as XmlNode[];
    let rPr = pPrChildren.find((c) => 'w:rPr' in c);
    if (!rPr) {
        rPr = { 'w:rPr': [] };
        pPrChildren.push(rPr);
    }
    return rPr;
}

/**
 * Walk the tree with context awareness — currently tracks whether the
 * cursor is inside `<w:rPr>` inside `<w:pPr>` so we can distinguish
 * paragraph-mark `<w:ins>`/`<w:del>` markers from content wrappers.
 */
function walkContext(
    tree: XmlTree,
    visit: (node: XmlNode, ctx: { insideRPrInsidePPr: boolean }) => void,
): void {
    function recurse(nodes: XmlNode[], insidePPr: boolean, insideRPr: boolean) {
        for (const node of nodes) {
            visit(node, { insideRPrInsidePPr: insidePPr && insideRPr });
            const tag = primaryTag(node);
            if (!tag) continue;
            const value = node[tag];
            if (!Array.isArray(value)) continue;
            const nextPPr = insidePPr || tag === 'w:pPr';
            const nextRPr = insideRPr || tag === 'w:rPr';
            recurse(value as XmlNode[], nextPPr, nextRPr);
        }
    }
    recurse(tree, false, false);
}
