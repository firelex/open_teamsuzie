import { describe, expect, it } from 'vitest';
import { prepareDocumentFromPages } from '../document.js';
import {
    validateCitation,
    validateCitations,
    verifyCitations,
} from '../validator.js';
import type { Citation } from '../types.js';

const cite = (over: Partial<Citation> = {}): Citation => ({
    id: 1,
    doc: 'd-test',
    quote: 'governed by the laws of the State of Delaware',
    ...over,
});

const sampleDoc = () =>
    prepareDocumentFromPages(
        [
            'Section 1. The agreement shall be governed by the laws of the State of Delaware.\n',
            'Section 2. Termination requires sixty (60) days written notice.\n',
            'Section 3. Force majeure clauses survive termination.\n',
        ],
        { handle: 'd-test' },
    );

describe('validateCitation — happy path', () => {
    it('confirms a quote that appears in the doc', () => {
        const r = validateCitation(cite(), sampleDoc());
        expect(r).toEqual({ ok: true });
    });

    it('does not require a locator', () => {
        const r = validateCitation(
            cite({ quote: 'sixty (60) days written notice' }),
            sampleDoc(),
        );
        expect(r).toEqual({ ok: true });
    });

    it('ignores the locator field when validating', () => {
        const r = validateCitation(
            cite({
                quote: 'Force majeure clauses survive termination',
                locator: 'made-up section reference',
            }),
            sampleDoc(),
        );
        expect(r).toEqual({ ok: true });
    });
});

describe('validateCitation — drift tolerance', () => {
    it('tolerates extra/collapsed whitespace', () => {
        const r = validateCitation(
            cite({ quote: 'governed   by\tthe\nlaws of the   State of Delaware' }),
            sampleDoc(),
        );
        expect(r.ok).toBe(true);
    });

    it('tolerates smart quote drift (curly → straight)', () => {
        const doc = prepareDocumentFromPages([
            'The party may terminate the "Agreement" at any time.\n',
        ]);
        const r = validateCitation(
            cite({
                doc: doc.handle,
                quote: 'terminate the “Agreement” at any time',
            }),
            doc,
        );
        expect(r.ok).toBe(true);
    });

    it('tolerates en-dash and em-dash drift', () => {
        const doc = prepareDocumentFromPages([
            'The term runs from 2025–2030 — inclusive of all extensions.\n',
        ]);
        const r = validateCitation(
            cite({
                doc: doc.handle,
                quote: 'from 2025-2030 - inclusive of all extensions',
            }),
            doc,
        );
        expect(r.ok).toBe(true);
    });

    it('tolerates curly single-quote / apostrophe drift', () => {
        const doc = prepareDocumentFromPages([
            'The Buyer’s representations shall survive closing.\n',
        ]);
        const r = validateCitation(
            cite({ doc: doc.handle, quote: "The Buyer's representations" }),
            doc,
        );
        expect(r.ok).toBe(true);
    });
});

describe('validateCitation — failures', () => {
    it('reports not_found for hallucinated quotes', () => {
        const r = validateCitation(
            cite({ quote: 'this clause does not exist anywhere in the agreement' }),
            sampleDoc(),
        );
        expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('treats an empty quote as not_found', () => {
        const r = validateCitation(cite({ quote: '' }), sampleDoc());
        expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('treats whitespace-only quote as not_found', () => {
        const r = validateCitation(cite({ quote: '   \n\t  ' }), sampleDoc());
        expect(r).toEqual({ ok: false, reason: 'not_found' });
    });
});

describe('validateCitation — case sensitivity', () => {
    it('is case-sensitive by default', () => {
        const r = validateCitation(
            cite({ quote: 'GOVERNED BY THE LAWS OF THE STATE OF DELAWARE' }),
            sampleDoc(),
        );
        expect(r.ok).toBe(false);
    });
});

describe('validateCitations — batch', () => {
    it('validates a list against a docs map', () => {
        const docA = prepareDocumentFromPages(
            ['First page of doc A.\n', 'Second page of doc A.\n'],
            { handle: 'a' },
        );
        const docB = prepareDocumentFromPages(
            ['Doc B page one with key phrase here.\n'],
            { handle: 'b' },
        );

        const citations: Citation[] = [
            { id: 1, doc: 'a', quote: 'First page of doc A' },
            { id: 2, doc: 'b', quote: 'key phrase here' },
            { id: 3, doc: 'a', quote: 'Second page of doc A' },
            { id: 4, doc: 'missing', quote: 'whatever' },
        ];

        const results = validateCitations(
            citations,
            new Map([
                ['a', docA],
                ['b', docB],
            ]),
        );

        expect(results).toHaveLength(4);
        expect(results[0]).toEqual({ ok: true });
        expect(results[1]).toEqual({ ok: true });
        expect(results[2]).toEqual({ ok: true });
        expect(results[3]).toEqual({ ok: false, reason: 'unknown_doc' });
    });

    it('accepts a plain object as the docs map', () => {
        const docA = prepareDocumentFromPages(['hello world\n'], { handle: 'a' });
        const results = validateCitations(
            [{ id: 1, doc: 'a', quote: 'hello world' }],
            { a: docA },
        );
        expect(results).toEqual([{ ok: true }]);
    });

    it('preserves input order', () => {
        const docA = prepareDocumentFromPages(['x\n'], { handle: 'a' });
        const citations: Citation[] = [
            { id: 1, doc: 'missing', quote: 'q' },
            { id: 2, doc: 'a', quote: 'x' },
            { id: 3, doc: 'missing', quote: 'q' },
        ];
        const results = validateCitations(citations, { a: docA });
        expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual([
            'unknown_doc',
            'ok',
            'unknown_doc',
        ]);
    });
});

describe('verifyCitations', () => {
    const source = '## 4. Termination\n\nEither party may terminate this Agreement on **thirty (30) days’** written notice.\n\n| Term | Value |\n| --- | --- |\n| Cap | $1,000,000 |';

    it('marks found, missing and unavailable quotes', () => {
        const out = verifyCitations(
            [
                { id: 1, doc: 'nda', quote: 'Either party may terminate this Agreement on thirty (30) days\' written notice' },
                { id: 2, doc: 'nda', quote: 'Either party may terminate at will' },
                { id: 3, doc: 'other', quote: 'anything' },
                { id: 4, doc: 'nda', quote: 'Cap $1,000,000' },
            ],
            { nda: source },
        );
        expect(out.map((c) => c.verification)).toEqual(['verified', 'not_found', 'unchecked', 'verified']);
    });

    it('ignores clause labels a converter turned into list numbering', () => {
        // Real case: Word's "(b)" became list number "5." after conversion.
        const converted = '5.  The provisions shall be (a) of no further force if such Investor ceases to be a Limited Partner and\n5.  suspended if and for so long as the General Partner designates any Investor as a Defaulting Partner.';
        const out = verifyCitations(
            [
                { id: 1, doc: 'sl', quote: 'of no further force if such Investor ceases to be a Limited Partner and (b) suspended if and for so long as' },
                { id: 2, doc: 'sl', quote: 'and (b) terminated if and for so long as' },
            ],
            { sl: converted },
        );
        expect(out.map((c) => c.verification)).toEqual(['verified', 'not_found']);
    });

    it('treats an empty quote as not found and leaves inputs untouched', () => {
        const input = [{ id: 1, doc: 'nda', quote: '  ' }];
        const out = verifyCitations(input, new Map([['nda', source]]));
        expect(out[0]!.verification).toBe('not_found');
        expect(input[0]).not.toHaveProperty('verification');
    });
});
