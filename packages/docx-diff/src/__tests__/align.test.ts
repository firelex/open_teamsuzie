import { describe, expect, it } from 'vitest';
import { alignParagraphs } from '../align.js';

describe('alignParagraphs', () => {
    it('returns an empty alignment for two empty inputs', () => {
        const r = alignParagraphs([], []);
        expect(r.matches).toEqual([]);
        expect(r.unmatchedB).toEqual([]);
    });

    it('flags every A paragraph as unmatched when B is empty', () => {
        const r = alignParagraphs(['p1', 'p2'], []);
        expect(r.matches).toHaveLength(2);
        for (const m of r.matches) {
            expect(m.status).toBe('unmatched');
            expect(m.bIndex).toBeNull();
            expect(m.bText).toBe('');
            expect(m.similarity).toBe(0);
        }
        expect(r.unmatchedB).toEqual([]);
    });

    it('flags every B paragraph as unmatchedB when A is empty', () => {
        const r = alignParagraphs([], ['p1', 'p2', 'p3']);
        expect(r.matches).toEqual([]);
        expect(r.unmatchedB).toEqual([0, 1, 2]);
    });

    it('aligns identical sequences 1:1 with status=ordered and confident=true', () => {
        const docs = [
            'The Borrower shall pay interest at the rate of 5% per annum.',
            'Either party may terminate upon thirty days written notice.',
            'Governing law: State of Delaware.',
        ];
        const r = alignParagraphs(docs, docs);
        expect(r.matches).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            expect(r.matches[i].aIndex).toBe(i);
            expect(r.matches[i].bIndex).toBe(i);
            expect(r.matches[i].status).toBe('ordered');
            expect(r.matches[i].similarity).toBe(1);
            expect(r.matches[i].confident).toBe(true);
        }
        expect(r.unmatchedB).toEqual([]);
    });

    it('detects an insertion in B (new paragraph) — A row matches, extra B in unmatchedB', () => {
        const a = [
            'The Borrower shall pay interest at the rate of 5% per annum.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const b = [
            'The Borrower shall pay interest at the rate of 5% per annum.',
            'The Lender may accelerate the loan upon any event of default.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const r = alignParagraphs(a, b);
        expect(r.matches).toHaveLength(2);
        expect(r.matches[0].bIndex).toBe(0);
        expect(r.matches[0].status).toBe('ordered');
        expect(r.matches[1].bIndex).toBe(2);
        expect(r.matches[1].status).toBe('ordered');
        expect(r.unmatchedB).toEqual([1]);
    });

    it('detects a deletion from A (paragraph dropped in B) — middle A unmatched', () => {
        const a = [
            'The Borrower shall pay interest at the rate of 5% per annum.',
            'The Lender may accelerate the loan upon any event of default.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const b = [
            'The Borrower shall pay interest at the rate of 5% per annum.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const r = alignParagraphs(a, b);
        expect(r.matches).toHaveLength(3);
        expect(r.matches[0].bIndex).toBe(0);
        expect(r.matches[1].status).toBe('unmatched');
        expect(r.matches[1].bIndex).toBeNull();
        expect(r.matches[2].bIndex).toBe(1);
        expect(r.unmatchedB).toEqual([]);
    });

    it('handles a paraphrased middle paragraph as ordered with similarity < 1', () => {
        const a = [
            'The Borrower shall pay interest at the rate of 5% per annum on the outstanding principal.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const b = [
            'The Borrower shall pay interest at the rate of 7% per annum on the outstanding principal.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const r = alignParagraphs(a, b);
        expect(r.matches[0].status).toBe('ordered');
        expect(r.matches[0].bIndex).toBe(0);
        expect(r.matches[0].similarity).toBeGreaterThan(0.8);
        expect(r.matches[0].similarity).toBeLessThan(1);
        expect(r.matches[1].similarity).toBe(1);
    });

    it('detects a moved paragraph (Heckel-style) — A1 swapped with A2 in B', () => {
        const a = [
            'Section 1. The Borrower shall pay interest at the rate of 5% per annum on the outstanding principal balance.',
            'Section 2. Either party may terminate this agreement upon thirty days prior written notice.',
            'Section 3. The governing law shall be the laws of the State of Delaware without regard to conflicts.',
        ];
        const b = [
            // Section 1 unchanged
            'Section 1. The Borrower shall pay interest at the rate of 5% per annum on the outstanding principal balance.',
            // Section 3 moved up
            'Section 3. The governing law shall be the laws of the State of Delaware without regard to conflicts.',
            // Section 2 moved down
            'Section 2. Either party may terminate this agreement upon thirty days prior written notice.',
        ];
        const r = alignParagraphs(a, b);
        // Every A paragraph should pair with its B counterpart exactly.
        expect(r.matches[0].bIndex).toBe(0);
        expect(r.matches[1].bIndex).toBe(2);
        expect(r.matches[2].bIndex).toBe(1);
        // At least one of the two displaced paragraphs is flagged 'moved'
        // (the LIS spine keeps one of them as 'ordered').
        const movedCount = r.matches.filter((m) => m.status === 'moved').length;
        expect(movedCount).toBeGreaterThanOrEqual(1);
        expect(r.unmatchedB).toEqual([]);
    });

    it('keeps unrelated paragraphs unmatched when B replaces A wholesale', () => {
        const a = [
            'The Borrower shall pay interest at the rate of 5% per annum.',
            'Either party may terminate upon thirty days written notice.',
        ];
        const b = [
            'The premises consist of approximately 5,000 rentable square feet.',
            'The Tenant shall maintain commercial general liability insurance.',
        ];
        const r = alignParagraphs(a, b);
        for (const m of r.matches) {
            expect(m.status).toBe('unmatched');
            expect(m.bIndex).toBeNull();
        }
        expect(r.unmatchedB).toEqual([0, 1]);
    });

    it('combines insertion + paraphrase + deletion in a single alignment', () => {
        const a = [
            'The Borrower shall pay interest at 5% per annum on the outstanding principal balance.',
            'The Lender may accelerate the loan upon any event of default specified in Section 7.',
            'Either party may terminate upon thirty days prior written notice.',
            'This agreement shall be governed by the laws of Delaware.',
        ];
        const b = [
            'The Borrower shall pay interest at 7% per annum on the outstanding principal balance.', // paraphrased
            'A new representations-and-warranties clause inserted by buyer’s counsel.', // inserted
            // (A[1] deleted)
            'Either party may terminate upon thirty days prior written notice.',
            'This agreement shall be governed by the laws of Delaware.',
        ];
        const r = alignParagraphs(a, b);
        expect(r.matches[0].bIndex).toBe(0); // paraphrase
        expect(r.matches[0].status).toBe('ordered');
        expect(r.matches[1].status).toBe('unmatched'); // deleted
        expect(r.matches[2].bIndex).toBe(2);
        expect(r.matches[3].bIndex).toBe(3);
        expect(r.unmatchedB).toEqual([1]); // inserted
    });
});

describe('alignParagraphs length-ratio gate', () => {
    it('unpairs a short paragraph contained inside a much longer one (default 0.4 threshold)', () => {
        // 9 tokens on left vs 38 tokens on right — ratio ≈ 0.24, below 0.4.
        // Containment-weighted similarity would happily pair them (the short
        // side is mostly inside the long side); the gate rejects.
        const a = [
            'The Borrower shall pay interest at five percent per annum.',
        ];
        const b = [
            'The Borrower shall pay interest at five percent per annum on the outstanding principal balance, computed monthly on the basis of a 360-day year and the actual number of days elapsed in each calculation period, payable in arrears on each Payment Date as defined in Section 3.1 below.',
        ];
        const r = alignParagraphs(a, b);
        // LEFT becomes a pure-delete; RIGHT becomes a pure-insert
        expect(r.matches[0].bIndex).toBeNull();
        expect(r.matches[0].status).toBe('unmatched');
        expect(r.unmatchedB).toEqual([0]);
    });

    it('keeps the indemnification subset case paired (ratio ~0.5, above 0.4)', () => {
        // 19 vs 38 tokens — ratio = 0.5, above the 0.4 threshold.
        const a = [
            'The Company shall indemnify and hold harmless the Indemnitee from and against any losses arising from third-party claims.',
        ];
        const b = [
            'Section 7. Indemnification. The Company shall indemnify and hold harmless the Indemnitee from and against any losses arising from third-party claims, except in cases of gross negligence or willful misconduct as determined by a court of competent jurisdiction.',
        ];
        const r = alignParagraphs(a, b);
        expect(r.matches[0].bIndex).toBe(0);
        expect(r.matches[0].status).toBe('ordered');
    });

    it('does not apply the gate when both paragraphs are short (term expansion)', () => {
        // 1 token vs 5 tokens — ratio is small but both are below the
        // 8-token minimum, so the gate doesn't fire and containment
        // matching can still pair them.
        const a = ['Investor'];
        const b = ['Investor (the "Investor")'];
        const r = alignParagraphs(a, b);
        expect(r.matches[0].bIndex).toBe(0);
    });

    it('respects a custom minLengthRatio override', () => {
        const a = [
            'The Company shall indemnify and hold harmless the Indemnitee from and against any losses arising from third-party claims.',
        ];
        const b = [
            'Section 7. Indemnification. The Company shall indemnify and hold harmless the Indemnitee from and against any losses arising from third-party claims, except in cases of gross negligence or willful misconduct as determined by a court of competent jurisdiction.',
        ];
        // Default 0.4 keeps these paired; raise to 0.6 and they unpair.
        const strict = alignParagraphs(a, b, { minLengthRatio: 0.6 });
        expect(strict.matches[0].bIndex).toBeNull();

        // Lower to 0.1 to confirm the override is respected the other way.
        const lax = alignParagraphs(a, b, { minLengthRatio: 0.1 });
        expect(lax.matches[0].bIndex).toBe(0);
    });
});
