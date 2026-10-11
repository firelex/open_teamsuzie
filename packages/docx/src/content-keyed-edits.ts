import { DocxFile } from './docx-file.js';
import {
    TrackedChangesEditor,
    bodyParagraphTexts,
    buildRunRPr,
    type RevisionAuthor,
    type RichRun,
    type WordDiffOp,
} from './tracked-changes.js';
import type { XmlNode } from './types.js';

/**
 * A single tracked-change edit specified by content + surrounding context
 * rather than by paragraph index. The `find` substring is located within
 * the document at the unique position where it's preceded by `contextBefore`
 * and followed by `contextAfter` (after light normalization — smart quotes,
 * non-breaking spaces, em-dashes are folded to ASCII equivalents). If
 * `find` is empty the edit is a pure insertion at the position where
 * `contextBefore + contextAfter` meets.
 */
export interface ContentKeyedEdit {
    find: string;
    replace: string;
    /**
     * When present, the replacement is emitted as multiple `<w:r>` elements
     * with inline formatting (bold, italic, underline) instead of a single
     * plain-text run. The concatenated text of all runs is used as the
     * replacement text for the word-level diff; individual run boundaries
     * are NOT preserved during the diff — the runs are only used for the
     * final insert emission.
     *
     * The `replace` field is still required and should equal the plain-text
     * concatenation of `replaceRuns[].text` so that the word-level diff
     * (`diffReplacement`) has a stable string to work against. If `replaceRuns`
     * is present, the insert ops from the diff are emitted as rich runs
     * instead of a single plain run.
     */
    replaceRuns?: RichRun[];
    /** Text immediately preceding `find` in the source document. May be empty. */
    contextBefore: string;
    /** Text immediately following `find` in the source document. May be empty. */
    contextAfter: string;
    /** Optional human-readable rationale; passed through to the result. */
    reason?: string;
}

export type AppliedEditStatus =
    | 'applied'
    | 'not_found'
    | 'ambiguous'
    | 'no_op';

export interface AppliedEditResult {
    status: AppliedEditStatus;
    /** Revision ids issued if anything was emitted (one per `<w:del>` and one per `<w:ins>`). */
    revisionIds: number[];
    /** Human-readable explanation when status !== 'applied'. */
    reason?: string;
}

/**
 * Apply a list of content-keyed tracked-change edits to a DOCX. Each edit
 * is located independently via find+context disambiguation; edits within
 * the same paragraph are batched and emitted as a single
 * `applyParagraphDiff` call so flatten/reconstruct preserves run-level
 * formatting per fragment.
 *
 * Results are returned in input order; an edit that fails to locate (no
 * unique match, no match at all, or empty find+replace) gets a structured
 * status without affecting the others. The DOCX is mutated in place; call
 * `file.save()` to materialize the bytes.
 */
/** One paragraph's planned change: the full word-level ops, and which edit each non-equal op belongs to. */
export interface PlannedParagraph {
    paragraphIndex: number;
    /** Word-level ops covering the whole paragraph text (equal / delete / insert). */
    ops: WordDiffOp[];
    /** For each op in `ops`, the index of the edit it belongs to, or -1 for unchanged text. */
    opEdits: number[];
}

export interface ContentKeyedPlan {
    /** Per input edit, in input order: whether it can be applied, and where. */
    results: Array<{ status: AppliedEditStatus; reason?: string; paragraphIndex?: number }>;
    /** The paragraphs that change, in document order. */
    paragraphs: PlannedParagraph[];
}

/**
 * Plan content-keyed edits against plain paragraph texts, without a DOCX:
 * locate each edit (find + context, after light normalization), reject
 * overlaps, and refine each find→replace into word-level ops so a coarse
 * edit still yields a minimal redline. `applyContentKeyedEdits` uses this
 * and then writes the ops as tracked changes; callers with text only (for
 * example clause text held in a database) use the plan directly.
 */
export function planContentKeyedEdits(paragraphs: string[], edits: ContentKeyedEdit[]): ContentKeyedPlan {
    const results: ContentKeyedPlan['results'] = edits.map(() => ({ status: 'not_found' }));

    interface LocatedEdit {
        editIndex: number;
        paragraphIndex: number;
        startInPara: number;
        endInPara: number;
        replace: string;
    }
    const byParagraph = new Map<number, LocatedEdit[]>();

    for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (edit.find.length === 0 && edit.replace.length === 0) {
            results[i] = { status: 'no_op', reason: 'find and replace are both empty' };
            continue;
        }
        const located = locateEdit(paragraphs, edit);
        if (located.status === 'not_found' || located.status === 'ambiguous') {
            results[i] = { status: located.status, reason: located.reason };
            continue;
        }
        const list = byParagraph.get(located.paragraphIndex) ?? [];
        list.push({ editIndex: i, paragraphIndex: located.paragraphIndex, startInPara: located.startInPara, endInPara: located.endInPara, replace: edit.replace });
        byParagraph.set(located.paragraphIndex, list);
    }

    const planned: PlannedParagraph[] = [];
    for (const [paraIdx, paraEdits] of [...byParagraph.entries()].sort((a, b) => a[0] - b[0])) {
        paraEdits.sort((a, b) => a.startInPara - b.startInPara);
        // Reject overlapping edits within the same paragraph — caller can
        // retry with non-overlapping ones.
        for (let k = 1; k < paraEdits.length; k++) {
            if (paraEdits[k].startInPara < paraEdits[k - 1].endInPara) {
                results[paraEdits[k].editIndex] = { status: 'ambiguous', reason: 'overlaps with another edit in the same paragraph' };
                paraEdits.splice(k, 1);
                k--;
            }
        }
        if (paraEdits.length === 0) continue;

        const paraText = paragraphs[paraIdx];
        const ops: WordDiffOp[] = [];
        const opEdits: number[] = [];
        let cursor = 0;
        for (const e of paraEdits) {
            if (e.startInPara > cursor) {
                ops.push({ kind: 'equal', text: paraText.slice(cursor, e.startInPara) });
                opEdits.push(-1);
            }
            const deleteText = paraText.slice(e.startInPara, e.endInPara);
            for (const op of diffReplacement(deleteText, e.replace)) {
                ops.push(op);
                opEdits.push(op.kind === 'equal' ? -1 : e.editIndex);
            }
            cursor = e.endInPara;
        }
        if (cursor < paraText.length) {
            ops.push({ kind: 'equal', text: paraText.slice(cursor) });
            opEdits.push(-1);
        }
        for (const e of paraEdits) results[e.editIndex] = { status: 'applied', paragraphIndex: paraIdx };
        planned.push({ paragraphIndex: paraIdx, ops, opEdits });
    }
    return { results, paragraphs: planned };
}

export function applyContentKeyedEdits(
    file: DocxFile,
    edits: ContentKeyedEdit[],
    author: RevisionAuthor,
): AppliedEditResult[] {
    const plan = planContentKeyedEdits(bodyParagraphTexts(file), edits);
    const results: AppliedEditResult[] = plan.results.map((r) => ({
        status: r.status,
        revisionIds: [],
        ...(r.reason ? { reason: r.reason } : {}),
    }));

    const editor = new TrackedChangesEditor(file, author);
    for (const para of plan.paragraphs) {
        const editIndexes = [...new Set(para.opEdits.filter((e) => e >= 0))];
        let issuedIds: number[];
        try {
            issuedIds = editor.applyParagraphDiff(para.paragraphIndex, para.ops, {
                inheritFormatting: true,
            });
        } catch (err) {
            for (const e of editIndexes) {
                results[e] = {
                    status: 'not_found',
                    revisionIds: [],
                    reason: err instanceof Error ? err.message : 'apply failed',
                };
            }
            continue;
        }

        // Distribute the issued ids back to per-edit results (one id per
        // non-equal op, in order), and apply rich-run overrides for insert
        // ops belonging to edits that specify replaceRuns.
        const opMeta = para.ops
            .map((op, i) => ({ kind: op.kind, editIndex: para.opEdits[i] }))
            .filter((m) => m.kind !== 'equal');
        const editIds = new Map<number, number[]>(editIndexes.map((e) => [e, []]));
        for (let opIdx = 0; opIdx < opMeta.length && opIdx < issuedIds.length; opIdx++) {
            const { kind, editIndex } = opMeta[opIdx];
            const id = issuedIds[opIdx];
            editIds.get(editIndex)!.push(id);
            const richRuns = edits[editIndex].replaceRuns;
            if (kind === 'insert' && richRuns) editor.overrideInsertedRunContent(id, richRuns);
        }
        for (const e of editIndexes) {
            results[e] = { status: 'applied', revisionIds: editIds.get(e) ?? [] };
        }
    }

    return results;
}

interface LocateResult {
    status: 'applied' | 'not_found' | 'ambiguous';
    paragraphIndex: number;
    startInPara: number;
    endInPara: number;
    reason?: string;
}

function locateEdit(
    paragraphs: string[],
    edit: ContentKeyedEdit,
): LocateResult {
    const normFind = normalizeWs(edit.find).norm;
    const normCtxBefore = normalizeWs(edit.contextBefore).norm;
    const normCtxAfter = normalizeWs(edit.contextAfter).norm;
    const paraNorms = paragraphs.map((p) => normalizeWs(p));
    type Hit = { paragraphIndex: number; normStart: number; normEnd: number };

    const tryStrategy = (
        ctxBefore: string,
        ctxAfter: string,
    ): { kind: 'ok'; hits: Hit[] } | { kind: 'ambiguous'; count: number } => {
        const hits: Hit[] = [];
        let candidateCount = 0;
        let ambiguous = false;
        for (let i = 0; i < paraNorms.length; i++) {
            const found = findUniqueAnchor(
                paraNorms[i].norm,
                normFind,
                ctxBefore,
                ctxAfter,
            );
            if ('error' in found) {
                if (found.error === 'ambiguous') ambiguous = true;
                continue;
            }
            candidateCount++;
            hits.push({
                paragraphIndex: i,
                normStart: found.start,
                normEnd: found.end,
            });
        }
        if (ambiguous || hits.length > 1)
            return { kind: 'ambiguous', count: Math.max(candidateCount, hits.length) };
        return { kind: 'ok', hits };
    };

    const attempts = [
        { before: normCtxBefore, after: normCtxAfter },
        { before: normCtxBefore, after: '' },
        { before: '', after: normCtxAfter },
        { before: '', after: '' },
    ];
    let sawAmbiguous = false;
    let ambiguousCount = 0;
    for (const attempt of attempts) {
        const result = tryStrategy(attempt.before, attempt.after);
        if (result.kind === 'ambiguous') {
            sawAmbiguous = true;
            ambiguousCount = Math.max(ambiguousCount, result.count);
            continue;
        }
        if (result.hits.length !== 1) continue;
        const hit = result.hits[0];
        const originalRange = mapNormRangeToOriginal(
            paraNorms[hit.paragraphIndex],
            paragraphs[hit.paragraphIndex].length,
            hit.normStart,
            hit.normEnd,
        );
        return {
            status: 'applied',
            paragraphIndex: hit.paragraphIndex,
            startInPara: originalRange.start,
            endInPara: originalRange.end,
        };
    }

    if (!sawAmbiguous) {
        return {
            status: 'not_found',
            paragraphIndex: -1,
            startInPara: -1,
            endInPara: -1,
            reason: `find + context not found in document`,
        };
    }
    return {
        status: 'ambiguous',
        paragraphIndex: -1,
        startInPara: -1,
        endInPara: -1,
        reason: `find + context matched ${ambiguousCount || 'multiple'} positions; provide more disambiguating context`,
    };
}

/**
 * Text normalization for anchor matching. Collapses smart quotes,
 * em/en dashes, non-breaking spaces, and arbitrary whitespace runs to a
 * shape closer to the model's markdown view of a DOCX. A remap is kept so
 * matches in the normalized string can still mutate the original paragraph
 * offsets.
 */
interface NormalizedText {
    norm: string;
    origIdx: number[];
}

function normalizeWs(s: string): NormalizedText {
    let norm = '';
    const origIdx: number[] = [];
    let prevSpace = false;
    for (let i = 0; i < s.length; i++) {
        const folded = foldChar(s[i]);
        if (folded === '') continue;
        if (/\s/.test(folded)) {
            if (!prevSpace) {
                norm += ' ';
                origIdx.push(i);
                prevSpace = true;
            }
            continue;
        }
        norm += folded;
        origIdx.push(i);
        prevSpace = false;
    }
    return { norm, origIdx };
}

function foldChar(ch: string): string {
    if (/[‘’′]/.test(ch)) return "'";
    if (/[“”″]/.test(ch)) return '"';
    if (/[–—]/.test(ch)) return '-';
    if (ch === ' ') return ' ';
    if (ch === '​') return '';
    return ch;
}

function findUniqueAnchor(
    hayNorm: string,
    findNorm: string,
    ctxBeforeNorm: string,
    ctxAfterNorm: string,
): { start: number; end: number } | { error: 'none' | 'ambiguous' } {
    const candidates: number[] = [];
    const checkContext = (pos: number): boolean => {
        if (ctxBeforeNorm.length > 0) {
            const start = pos - ctxBeforeNorm.length;
            if (start < 0) return false;
            if (hayNorm.slice(start, pos) !== ctxBeforeNorm) return false;
        }
        if (ctxAfterNorm.length > 0) {
            const end = pos + findNorm.length;
            if (hayNorm.slice(end, end + ctxAfterNorm.length) !== ctxAfterNorm)
                return false;
        }
        return true;
    };

    if (findNorm.length === 0) {
        for (let i = 0; i <= hayNorm.length; i++) {
            if (checkContext(i)) candidates.push(i);
        }
    } else {
        for (const p of indexAll(hayNorm, findNorm)) {
            if (checkContext(p)) candidates.push(p);
        }
    }

    if (candidates.length === 0) return { error: 'none' };
    if (candidates.length > 1) return { error: 'ambiguous' };
    return { start: candidates[0], end: candidates[0] + findNorm.length };
}

function mapNormRangeToOriginal(
    normalized: NormalizedText,
    originalLength: number,
    normStart: number,
    normEnd: number,
): { start: number; end: number } {
    const start =
        normStart < normalized.origIdx.length
            ? normalized.origIdx[normStart]
            : originalLength;
    const end =
        normEnd === normStart
            ? start
            : normEnd - 1 < normalized.origIdx.length
              ? normalized.origIdx[normEnd - 1] + 1
              : originalLength;
    return { start, end };
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

// Word-level replacement refinement. Models often send a whole clause or
// paragraph as `find` plus the revised clause as `replace`; applying that
// literally creates a noisy delete-all/insert-all redline. Diffing the two
// strings here keeps the model's contract simple while emitting native
// tracked changes only around the words that actually changed.
const ATOM_RE = /\s+|(?:[\p{L}\p{N}_'‘’′]+|[^\p{L}\p{N}_'‘’′\s])\s*/gu;

function diffReplacement(original: string, replacement: string): WordDiffOp[] {
    if (original === replacement) {
        return original.length === 0 ? [] : [{ kind: 'equal', text: original }];
    }
    const a = tokenize(original);
    const b = tokenize(replacement);
    const aKeys = a.map(tokenKey);
    const bKeys = b.map(tokenKey);
    if (a.length === 0) {
        return replacement.length === 0
            ? []
            : [{ kind: 'insert', text: replacement }];
    }
    if (b.length === 0) return [{ kind: 'delete', text: original }];

    const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
        new Array(b.length + 1).fill(0),
    );
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] =
                aKeys[i - 1] === bKeys[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    const reversed: WordDiffOp[] = [];
    let i = a.length;
    let j = b.length;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && aKeys[i - 1] === bKeys[j - 1]) {
            reversed.push({ kind: 'equal', text: a[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            reversed.push({ kind: 'insert', text: b[j - 1] });
            j--;
        } else {
            reversed.push({ kind: 'delete', text: a[i - 1] });
            i--;
        }
    }
    reversed.reverse();
    return coalesceOps(reversed);
}

function tokenize(s: string): string[] {
    return s.match(ATOM_RE) ?? [];
}

function tokenKey(s: string): string {
    let out = '';
    for (const ch of s) out += foldChar(ch);
    return out;
}

function coalesceOps(ops: WordDiffOp[]): WordDiffOp[] {
    const out: WordDiffOp[] = [];
    for (const op of ops) {
        const last = out[out.length - 1];
        if (last && last.kind === op.kind) {
            last.text += op.text;
        } else {
            out.push({ ...op });
        }
    }
    return out;
}
