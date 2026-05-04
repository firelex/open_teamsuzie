import { describe, expect, it } from 'vitest';
import { diffWords, type WordDiffOp } from '../word-diff.js';

/** Stitch ops back together: equal+delete should reproduce A; equal+insert should reproduce B. */
function reconstruct(ops: WordDiffOp[]): { a: string; b: string } {
    let a = '';
    let b = '';
    for (const op of ops) {
        if (op.kind === 'equal') {
            a += op.text;
            b += op.text;
        } else if (op.kind === 'delete') {
            a += op.text;
        } else {
            b += op.text;
        }
    }
    return { a, b };
}

describe('diffWords', () => {
    it('identical strings collapse to a single equal op', () => {
        const s = 'The Borrower shall pay interest at 5% per annum.';
        expect(diffWords(s, s)).toEqual([{ kind: 'equal', text: s }]);
    });

    it('two empty strings produce no ops', () => {
        expect(diffWords('', '')).toEqual([]);
    });

    it('empty A produces a single insert', () => {
        expect(diffWords('', 'hello world')).toEqual([
            { kind: 'insert', text: 'hello world' },
        ]);
    });

    it('empty B produces a single delete', () => {
        expect(diffWords('hello world', '')).toEqual([
            { kind: 'delete', text: 'hello world' },
        ]);
    });

    it('threshold change (5% → 7%) localises to the digit, % and trailing equal stay together', () => {
        const a = 'The Borrower shall pay interest at 5% per annum.';
        const b = 'The Borrower shall pay interest at 7% per annum.';
        const ops = diffWords(a, b);
        expect(ops).toEqual([
            { kind: 'equal', text: 'The Borrower shall pay interest at ' },
            { kind: 'delete', text: '5' },
            { kind: 'insert', text: '7' },
            { kind: 'equal', text: '% per annum.' },
        ]);
        expect(reconstruct(ops)).toEqual({ a, b });
    });

    it('defined-term swap (Borrower → Lender) — trailing space attaches to the changed term', () => {
        const a = 'The Borrower shall maintain insurance coverage at all times.';
        const b = 'The Lender shall maintain insurance coverage at all times.';
        const ops = diffWords(a, b);
        expect(ops).toEqual([
            { kind: 'equal', text: 'The ' },
            { kind: 'delete', text: 'Borrower ' },
            { kind: 'insert', text: 'Lender ' },
            { kind: 'equal', text: 'shall maintain insurance coverage at all times.' },
        ]);
        expect(reconstruct(ops)).toEqual({ a, b });
    });

    it('clause softening (insert "reasonable" before "efforts") shows a single insert run', () => {
        const a = 'The parties shall use efforts to resolve disputes amicably.';
        const b = 'The parties shall use reasonable efforts to resolve disputes amicably.';
        const ops = diffWords(a, b);
        expect(ops).toEqual([
            { kind: 'equal', text: 'The parties shall use ' },
            { kind: 'insert', text: 'reasonable ' },
            { kind: 'equal', text: 'efforts to resolve disputes amicably.' },
        ]);
        expect(reconstruct(ops)).toEqual({ a, b });
    });

    it('multi-word phrase swap ("thirty days" → "ninety calendar days") stays contiguous', () => {
        const a = 'Either party may terminate upon thirty days written notice.';
        const b = 'Either party may terminate upon ninety calendar days written notice.';
        const ops = diffWords(a, b);
        expect(ops).toEqual([
            { kind: 'equal', text: 'Either party may terminate upon ' },
            { kind: 'delete', text: 'thirty ' },
            { kind: 'insert', text: 'ninety calendar ' },
            { kind: 'equal', text: 'days written notice.' },
        ]);
        expect(reconstruct(ops)).toEqual({ a, b });
    });

    it('biases backtrace so deletes appear before inserts on ties', () => {
        // Single-word replacement, no shared atom inside the change region.
        const ops = diffWords('cat', 'dog');
        expect(ops).toEqual([
            { kind: 'delete', text: 'cat' },
            { kind: 'insert', text: 'dog' },
        ]);
    });

    it('coalesces adjacent same-kind atoms into single runs', () => {
        const a = 'alpha beta gamma';
        const b = 'alpha delta epsilon zeta gamma';
        const ops = diffWords(a, b);
        expect(ops).toEqual([
            { kind: 'equal', text: 'alpha ' },
            { kind: 'delete', text: 'beta ' },
            { kind: 'insert', text: 'delta epsilon zeta ' },
            { kind: 'equal', text: 'gamma' },
        ]);
        expect(reconstruct(ops)).toEqual({ a, b });
    });

    it('treats casing as a real change (Borrower vs borrower differ)', () => {
        const a = 'the Borrower shall pay';
        const b = 'the borrower shall pay';
        const ops = diffWords(a, b);
        expect(ops).toEqual([
            { kind: 'equal', text: 'the ' },
            { kind: 'delete', text: 'Borrower ' },
            { kind: 'insert', text: 'borrower ' },
            { kind: 'equal', text: 'shall pay' },
        ]);
    });

    it('keeps "5%" and "7%" split on punctuation so % stays equal', () => {
        const ops = diffWords('rate is 5%.', 'rate is 7%.');
        expect(ops).toEqual([
            { kind: 'equal', text: 'rate is ' },
            { kind: 'delete', text: '5' },
            { kind: 'insert', text: '7' },
            { kind: 'equal', text: '%.' },
        ]);
    });

    it('handles numbered cross-references (Section 7.1.2 → 7.1.3) at the leaf digit', () => {
        const ops = diffWords('see Section 7.1.2 for details', 'see Section 7.1.3 for details');
        expect(ops).toEqual([
            { kind: 'equal', text: 'see Section 7.1.' },
            { kind: 'delete', text: '2 ' },
            { kind: 'insert', text: '3 ' },
            { kind: 'equal', text: 'for details' },
        ]);
    });

    it('handles wholly different paragraphs (no equal op contains alphabetic content)', () => {
        const a = 'The premises consist of approximately 5,000 rentable square feet.';
        const b = 'Tenant shall maintain commercial general liability insurance.';
        const ops = diffWords(a, b);
        expect(reconstruct(ops)).toEqual({ a, b });
        for (const op of ops) {
            if (op.kind === 'equal') {
                expect(/[A-Za-z]/.test(op.text)).toBe(false);
            }
        }
    });

    it("apostrophes stay inside word atoms (Borrower's = single token)", () => {
        const ops = diffWords("the Borrower's obligations", "the Lender's obligations");
        expect(ops).toEqual([
            { kind: 'equal', text: 'the ' },
            { kind: 'delete', text: "Borrower's " },
            { kind: 'insert', text: "Lender's " },
            { kind: 'equal', text: 'obligations' },
        ]);
    });

    it('reconstruct invariant holds across every fixture above', () => {
        const cases: Array<[string, string]> = [
            ['', ''],
            ['', 'inserted text'],
            ['deleted text', ''],
            ['identical', 'identical'],
            ['rate at 5% per annum', 'rate at 7.5% per annum'],
            [
                'Borrower shall maintain insurance coverage at all times.',
                'Lender shall maintain insurance coverage at all times during the term.',
            ],
            ['  leading whitespace stays', '  leading whitespace stays here'],
        ];
        for (const [a, b] of cases) {
            expect(reconstruct(diffWords(a, b))).toEqual({ a, b });
        }
    });
});
