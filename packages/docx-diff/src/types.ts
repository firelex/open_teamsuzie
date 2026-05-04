/**
 * Status of a paragraph match within an alignment.
 *
 *   'ordered'   — paired with a B paragraph by the primary Needleman–Wunsch
 *                 pass; ordering is preserved relative to other matches.
 *   'unmatched' — no B paragraph paired (an insertion in A relative to B,
 *                 or a deletion of B relative to A, depending on direction).
 *   'moved'     — paired in a second pass after the monotonic NW couldn't
 *                 reach it; the content matches a B paragraph that lives
 *                 elsewhere in B's ordering. Same content, different position.
 */
export type ParagraphMatchStatus = 'ordered' | 'unmatched' | 'moved';

export interface ParagraphMatch {
    /** Index in the A (left) sequence. */
    aIndex: number;
    /** Index in the B (right) sequence, or null if unmatched. */
    bIndex: number | null;
    /** The A paragraph text. */
    aText: string;
    /** The matched B paragraph text, or '' if unmatched. */
    bText: string;
    /** Containment-weighted similarity, 0–1. Zero when unmatched. */
    similarity: number;
    /** True when similarity is high or context reinforces the match. */
    confident: boolean;
    status: ParagraphMatchStatus;
}

export interface AlignmentResult {
    /** One entry per A paragraph, in order. */
    matches: ParagraphMatch[];
    /**
     * Indices in B that no entry in `matches` paired with — these represent
     * paragraphs present in B but absent from A (insertions if A is "before"
     * and B is "after", or deletions in the reverse direction).
     */
    unmatchedB: number[];
}
