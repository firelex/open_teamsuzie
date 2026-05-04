import { describe, expect, it } from 'vitest';
import {
    TrackedChangesEditor,
    acceptAllRevisions,
    acceptRevision,
    listRevisions,
    loadDocx,
    rejectAllRevisions,
    rejectRevision,
    saveDocx,
} from '../index.js';
import { buildMinimalDocx } from './fixtures.js';

const AUTHOR = { name: 'Counsel', date: '2026-05-02T12:00:00Z' };

function bodyXml(file: ReturnType<typeof loadDocx>): string {
    return file.readPart('word/document.xml')!.toString('utf-8');
}

function plainTextOf(file: ReturnType<typeof loadDocx>): string {
    // Naive: pull every w:t / w:delText content out of the serialized XML.
    // For tests, after accept/reject all w:delText should be gone.
    const xml = bodyXml(file);
    return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join('|');
}

describe('acceptRevision', () => {
    it('accepting an `ins` unwraps the wrapper, keeping the inserted text live', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'hello' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const [delId, insId] = editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'hello' },
            { kind: 'insert', text: 'goodbye' },
        ]);
        expect(acceptRevision(file, insId)).toBe(true);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        // The ins wrapper is gone but the goodbye text survives.
        expect(xml).not.toContain(`<w:ins w:id="${insId}"`);
        expect(xml).toContain('goodbye');
        // The del wrapper still exists (we didn't resolve it yet).
        expect(xml).toContain(`<w:del w:id="${delId}"`);
    });

    it('accepting a `del` removes the wrapped content entirely', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'hello' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const [delId] = editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'hello' },
            { kind: 'insert', text: 'goodbye' },
        ]);
        acceptRevision(file, delId);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain(`<w:del w:id="${delId}"`);
        expect(xml).not.toContain('hello');
        expect(xml).not.toContain('<w:delText');
    });
});

describe('rejectRevision', () => {
    it('rejecting an `ins` removes the inserted content entirely', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'hello' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const [, insId] = editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'hello' },
            { kind: 'insert', text: 'goodbye' },
        ]);
        rejectRevision(file, insId);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('goodbye');
        expect(xml).not.toContain(`<w:ins w:id="${insId}"`);
    });

    it('rejecting a `del` restores live text (delText → t)', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'hello' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const [delId] = editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'hello' },
            { kind: 'insert', text: 'goodbye' },
        ]);
        rejectRevision(file, delId);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain(`<w:del w:id="${delId}"`);
        expect(xml).not.toContain('<w:delText');
        // hello survives as live text
        expect(xml).toContain('<w:t xml:space="preserve">hello</w:t>');
    });
});

describe('paragraph-mark resolution', () => {
    it('accepting a deleted paragraph removes the paragraph-break (merges with next)', () => {
        const file = loadDocx(
            buildMinimalDocx([{ text: 'first' }, { text: 'second' }]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const id = editor.deleteParagraph(0);
        expect(editor.bodyParagraphCount()).toBe(2);

        acceptRevision(file, id);
        // After accept-all-on-this-id: del wrappers gone, paragraph-mark
        // del marker gone, paragraphs merged.
        expect(editor.bodyParagraphCount()).toBe(1);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('<w:del');
        expect(xml).not.toContain('<w:delText');
        expect(xml).not.toContain('first'); // content was deleted
        expect(xml).toContain('second');
    });

    it('rejecting an inserted paragraph removes the paragraph-break (merges with next)', () => {
        const file = loadDocx(
            buildMinimalDocx([{ text: 'first' }, { text: 'second' }]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const id = editor.insertParagraph(0, 'inserted middle');
        expect(editor.bodyParagraphCount()).toBe(3);

        rejectRevision(file, id);
        expect(editor.bodyParagraphCount()).toBe(2);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('inserted middle');
        expect(xml).not.toContain('<w:ins');
        // Both originals survive in their original order
        const a = xml.indexOf('first');
        const b = xml.indexOf('second');
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(a);
    });

    it('rejecting a deleted paragraph keeps the paragraph and restores live text', () => {
        const file = loadDocx(
            buildMinimalDocx([{ text: 'first' }, { text: 'second' }]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const id = editor.deleteParagraph(0);

        rejectRevision(file, id);
        expect(editor.bodyParagraphCount()).toBe(2);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('<w:del');
        expect(xml).not.toContain('<w:delText');
        expect(xml).toContain('first');
        expect(xml).toContain('second');
    });

    it('accepting an inserted paragraph keeps the paragraph but drops the markers', () => {
        const file = loadDocx(
            buildMinimalDocx([{ text: 'first' }, { text: 'second' }]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const id = editor.insertParagraph(0, 'inserted middle');

        acceptRevision(file, id);
        expect(editor.bodyParagraphCount()).toBe(3);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('<w:ins');
        expect(xml).toContain('inserted middle');
    });
});

describe('AC: 5 edits, 3 accepted + 2 rejected (final state matches expectation)', () => {
    it('matches the cherry-picked combination', () => {
        // Start: a paragraph with the text
        //   "The Borrower shall pay 5% per annum on the principal balance."
        // Apply a diff that produces FIVE revisions:
        //   1. delete "5"
        //   2. insert "7"
        //   3. delete "Borrower"
        //   4. insert "Lender"
        //   5. insert " (as defined in Section 1.1)"
        // Then accept revisions 1, 2, 5 and reject 3, 4. Expected final text:
        //   "The Borrower shall pay 7% per annum on the principal balance (as defined in Section 1.1)."
        const file = loadDocx(
            buildMinimalDocx([
                {
                    text:
                        'The Borrower shall pay 5% per annum on the principal balance.',
                },
            ]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);

        // Compose ops: equal "The " + del "Borrower" + ins "Lender" +
        // equal " shall pay " + del "5" + ins "7" +
        // equal "% per annum on the principal balance" +
        // ins " (as defined in Section 1.1)" + equal "."
        const ids = editor.applyParagraphDiff(0, [
            { kind: 'equal', text: 'The ' },
            { kind: 'delete', text: 'Borrower' },
            { kind: 'insert', text: 'Lender' },
            { kind: 'equal', text: ' shall pay ' },
            { kind: 'delete', text: '5' },
            { kind: 'insert', text: '7' },
            {
                kind: 'equal',
                text: '% per annum on the principal balance',
            },
            { kind: 'insert', text: ' (as defined in Section 1.1)' },
            { kind: 'equal', text: '.' },
        ]);
        expect(ids).toHaveLength(5);

        const [delBorrowerId, insLenderId, del5Id, ins7Id, insClauseId] = ids;
        // Accept: del "5", ins "7", ins " (as defined ...)"
        // Reject: del "Borrower", ins "Lender"
        acceptRevision(file, del5Id);
        acceptRevision(file, ins7Id);
        acceptRevision(file, insClauseId);
        rejectRevision(file, delBorrowerId);
        rejectRevision(file, insLenderId);

        // Reload to check the saved bytes
        const xml = bodyXml(loadDocx(saveDocx(file)));
        // No tracked-change wrappers should remain
        expect(xml).not.toContain('<w:ins');
        expect(xml).not.toContain('<w:del');
        expect(xml).not.toContain('<w:delText');

        // Concatenate run text in document order to see final paragraph text.
        const runText = [
            ...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g),
        ]
            .map((m) => m[1])
            .join('');
        expect(runText).toBe(
            'The Borrower shall pay 7% per annum on the principal balance (as defined in Section 1.1).',
        );
    });
});

describe('acceptAllRevisions / rejectAllRevisions', () => {
    it('accept-all yields the post-edit document (= the new version)', () => {
        const file = loadDocx(
            buildMinimalDocx([
                { text: 'The Borrower shall pay 5%.' },
            ]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(0, [
            { kind: 'equal', text: 'The Borrower shall pay ' },
            { kind: 'delete', text: '5' },
            { kind: 'insert', text: '7' },
            { kind: 'equal', text: '%.' },
        ]);
        const count = acceptAllRevisions(file);
        expect(count).toBe(2);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('<w:ins');
        expect(xml).not.toContain('<w:del');
        const runText = [
            ...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g),
        ]
            .map((m) => m[1])
            .join('');
        expect(runText).toBe('The Borrower shall pay 7%.');
    });

    it('reject-all yields the pre-edit document (= the original)', () => {
        const file = loadDocx(
            buildMinimalDocx([
                { text: 'The Borrower shall pay 5%.' },
            ]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(0, [
            { kind: 'equal', text: 'The Borrower shall pay ' },
            { kind: 'delete', text: '5' },
            { kind: 'insert', text: '7' },
            { kind: 'equal', text: '%.' },
        ]);
        const count = rejectAllRevisions(file);
        expect(count).toBe(2);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('<w:ins');
        expect(xml).not.toContain('<w:del');
        expect(xml).not.toContain('<w:delText');
        // Original "5" is back as live text
        const runText = [
            ...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g),
        ]
            .map((m) => m[1])
            .join('');
        expect(runText).toBe('The Borrower shall pay 5%.');
    });
});

describe('listRevisions', () => {
    it('returns nothing on an unmodified document', () => {
        const file = loadDocx(buildMinimalDocx());
        expect(listRevisions(file)).toEqual([]);
    });

    it('attribution (author + date) survives the round trip', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'hello' }]));
        const editor = new TrackedChangesEditor(file, {
            name: 'Senior Counsel',
            date: '2027-01-15T09:30:00Z',
        });
        editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'hello' },
            { kind: 'insert', text: 'goodbye' },
        ]);
        const reloaded = loadDocx(saveDocx(file));
        const revs = listRevisions(reloaded);
        expect(revs).toHaveLength(2);
        for (const r of revs) {
            expect(r.author).toBe('Senior Counsel');
            expect(r.date).toBe('2027-01-15T09:30:00Z');
        }
    });
});
