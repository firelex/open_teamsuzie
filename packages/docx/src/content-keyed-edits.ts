import { DocxFile } from './docx-file.js';
import {
    TrackedChangesEditor,
    bodyParagraphTexts,
    type RevisionAuthor,
    type WordDiffOp,
} from './tracked-changes.js';

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
export function applyContentKeyedEdits(
    file: DocxFile,
    edits: ContentKeyedEdit[],
    author: RevisionAuthor,
): AppliedEditResult[] {
    const paragraphs = bodyParagraphTexts(file);
    const results: AppliedEditResult[] = edits.map(() => ({
        status: 'not_found',
        revisionIds: [],
    }));

    interface LocatedEdit {
        editIndex: number;
        paragraphIndex: number;
        /** Half-open range of `find` within the paragraph's normalized text. */
        startInPara: number;
        endInPara: number;
        replace: string;
    }
    const byParagraph = new Map<number, LocatedEdit[]>();

    for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (edit.find.length === 0 && edit.replace.length === 0) {
            results[i] = {
                status: 'no_op',
                revisionIds: [],
                reason: 'find and replace are both empty',
            };
            continue;
        }
        const located = locateEdit(paragraphs, edit);
        if (located.status === 'not_found' || located.status === 'ambiguous') {
            results[i] = {
                status: located.status,
                revisionIds: [],
                reason: located.reason,
            };
            continue;
        }
        const list = byParagraph.get(located.paragraphIndex) ?? [];
        list.push({
            editIndex: i,
            paragraphIndex: located.paragraphIndex,
            startInPara: located.startInPara,
            endInPara: located.endInPara,
            replace: edit.replace,
        });
        byParagraph.set(located.paragraphIndex, list);
    }

    const editor = new TrackedChangesEditor(file, author);
    for (const [paraIdx, paraEdits] of byParagraph) {
        paraEdits.sort((a, b) => a.startInPara - b.startInPara);
        // Reject overlapping edits within the same paragraph — caller can
        // retry with non-overlapping ones.
        for (let k = 1; k < paraEdits.length; k++) {
            if (paraEdits[k].startInPara < paraEdits[k - 1].endInPara) {
                results[paraEdits[k].editIndex] = {
                    status: 'ambiguous',
                    revisionIds: [],
                    reason: 'overlaps with another edit in the same paragraph',
                };
                paraEdits.splice(k, 1);
                k--;
            }
        }
        if (paraEdits.length === 0) continue;

        const paraText = paragraphs[paraIdx];
        const ops: WordDiffOp[] = [];
        let cursor = 0;
        for (const e of paraEdits) {
            if (e.startInPara > cursor) {
                ops.push({
                    kind: 'equal',
                    text: paraText.slice(cursor, e.startInPara),
                });
            }
            const deleteText = paraText.slice(e.startInPara, e.endInPara);
            if (deleteText.length > 0) {
                ops.push({ kind: 'delete', text: deleteText });
            }
            if (e.replace.length > 0) {
                ops.push({ kind: 'insert', text: e.replace });
            }
            cursor = e.endInPara;
        }
        if (cursor < paraText.length) {
            ops.push({ kind: 'equal', text: paraText.slice(cursor) });
        }

        let issuedIds: number[];
        try {
            issuedIds = editor.applyParagraphDiff(paraIdx, ops, {
                inheritFormatting: true,
            });
        } catch (err) {
            for (const e of paraEdits) {
                results[e.editIndex] = {
                    status: 'not_found',
                    revisionIds: [],
                    reason: err instanceof Error ? err.message : 'apply failed',
                };
            }
            continue;
        }

        // Distribute the issued ids back to per-edit results (in op order:
        // each delete consumes one id, each insert consumes one id).
        let idCursor = 0;
        for (const e of paraEdits) {
            const ids: number[] = [];
            const hadDelete = e.endInPara > e.startInPara;
            const hadInsert = e.replace.length > 0;
            if (hadDelete && idCursor < issuedIds.length) ids.push(issuedIds[idCursor++]);
            if (hadInsert && idCursor < issuedIds.length) ids.push(issuedIds[idCursor++]);
            results[e.editIndex] = { status: 'applied', revisionIds: ids };
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
    const normFind = normalize(edit.find);
    const normCtxBefore = normalize(edit.contextBefore);
    const normCtxAfter = normalize(edit.contextAfter);

    const matches: Array<{
        paragraphIndex: number;
        startInPara: number;
        endInPara: number;
    }> = [];

    for (let i = 0; i < paragraphs.length; i++) {
        const normPara = normalize(paragraphs[i]);
        const positions: number[] =
            normFind.length === 0
                ? Array.from({ length: normPara.length + 1 }, (_, k) => k)
                : indexAll(normPara, normFind);
        for (const p of positions) {
            const ctxBeforeStart = p - normCtxBefore.length;
            const ctxAfterEnd = p + normFind.length + normCtxAfter.length;
            if (ctxBeforeStart < 0) continue;
            if (ctxAfterEnd > normPara.length) continue;
            if (
                normCtxBefore.length > 0 &&
                normPara.slice(ctxBeforeStart, p) !== normCtxBefore
            )
                continue;
            if (
                normCtxAfter.length > 0 &&
                normPara.slice(p + normFind.length, ctxAfterEnd) !==
                    normCtxAfter
            )
                continue;
            matches.push({
                paragraphIndex: i,
                startInPara: p,
                endInPara: p + normFind.length,
            });
        }
    }

    if (matches.length === 0) {
        return {
            status: 'not_found',
            paragraphIndex: -1,
            startInPara: -1,
            endInPara: -1,
            reason: `find + context not found in document`,
        };
    }
    if (matches.length > 1) {
        return {
            status: 'ambiguous',
            paragraphIndex: -1,
            startInPara: -1,
            endInPara: -1,
            reason: `find + context matched ${matches.length} positions; provide more disambiguating context`,
        };
    }
    return { status: 'applied', ...matches[0] };
}

/**
 * Light text normalization for anchor matching. Collapses smart quotes,
 * em/en dashes, and non-breaking spaces to ASCII equivalents — the kinds
 * of substitutions Word applies on autoformat that throw off literal
 * string matching against an LLM's view of the text. All replacements
 * are 1-to-1 so character offsets in the normalized string map directly
 * back to offsets in the original.
 */
function normalize(s: string): string {
    return s
        .replace(/[‘’′]/g, "'")
        .replace(/[“”″]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/ /g, ' ')
        .replace(/​/g, '');
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
