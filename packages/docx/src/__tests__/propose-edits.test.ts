import { describe, expect, it } from 'vitest';
import { generateDocx, proposeDocumentEdits } from '../index.js';

const AUTHOR = 'Counsel';

async function fixtureBytes(): Promise<Buffer> {
    // generateDocx gives us a real, structurally-valid DOCX without us
    // having to hand-roll the parts the redline path inspects (styles,
    // numbering, content-types). The Borrower sentence is intentionally
    // long enough to have multiple anchor candidates if context is
    // omitted.
    return await generateDocx({
        title: 'Loan Agreement',
        sections: [
            {
                heading: { text: 'Interest', level: 1 },
                paragraphs: [
                    'The Borrower shall pay interest at 5% per annum on the outstanding principal.',
                    'The Lender may waive interest at its sole discretion.',
                ],
            },
        ],
    });
}

describe('proposeDocumentEdits', () => {
    it('applies a single content-keyed edit and returns structured result', async () => {
        const bytes = await fixtureBytes();
        const result = proposeDocumentEdits({
            docxBytes: bytes,
            edits: [
                {
                    find: '5%',
                    replace: '7%',
                    context_before: 'interest at ',
                    context_after: ' per annum',
                    reason: 'rate bump',
                },
            ],
            author: AUTHOR,
        });

        expect(result.applied_count).toBe(1);
        expect(result.total).toBe(1);
        expect(result.errors).toEqual([]);
        expect(result.applied_edits).toHaveLength(1);
        expect(result.applied_edits[0].revision_ids.length).toBeGreaterThan(0);
        expect(result.applied_edits[0].paragraph_index).toBeGreaterThanOrEqual(0);
        expect(result.applied_edits[0].reason).toBe('rate bump');
        expect(result.bytes.length).toBeGreaterThan(1000);
        expect(result.summary).toContain('1 edit');
        expect(result.suggested_filename('contract.docx')).toBe(
            'contract__proposed_edits.docx',
        );
    });

    it('reports a not_found error when find string does not appear', async () => {
        const bytes = await fixtureBytes();
        const result = proposeDocumentEdits({
            docxBytes: bytes,
            edits: [
                {
                    find: 'nonexistent phrase that is definitely not present',
                    replace: 'replacement',
                    context_before: '',
                    context_after: '',
                },
            ],
            author: AUTHOR,
        });

        expect(result.applied_count).toBe(0);
        expect(result.applied_edits).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].status).toBe('not_found');
        expect(result.errors[0].index).toBe(0);
        expect(result.errors[0].find).toBe(
            'nonexistent phrase that is definitely not present',
        );
    });

    it('throws when edits array is empty', async () => {
        const bytes = await fixtureBytes();
        expect(() =>
            proposeDocumentEdits({
                docxBytes: bytes,
                edits: [],
                author: AUTHOR,
            }),
        ).toThrow('edits must be a non-empty array');
    });
});
