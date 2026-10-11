import { describe, expect, it } from 'vitest';
import {
    TrackedChangesEditor,
    acceptAllRevisions,
    acceptRevision,
    bodyParagraphTexts,
    listRevisions,
    loadDocx,
    rejectAllRevisions,
    rejectRevision,
    saveDocx,
} from '../index.js';
import PizZip from 'pizzip';
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

// ── Whole-paragraph deletions and insertions: accept-all / reject-all ────

function buildBodyDocx(bodyInner: string): Buffer {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyInner}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
</w:document>`;
    const zip = new PizZip();
    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
        '_rels/.rels',
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file('word/document.xml', docXml);
    return zip.generate({ type: 'nodebuffer' });
}

function docOf(...texts: string[]): ReturnType<typeof loadDocx> {
    return loadDocx(buildMinimalDocx(texts.map((text) => ({ text }))));
}

/** Paragraph texts after accept-all on a reloaded copy; asserts no revisions remain. */
function acceptedTexts(file: ReturnType<typeof loadDocx>): string[] {
    const copy = loadDocx(saveDocx(file));
    acceptAllRevisions(copy);
    expect(listRevisions(copy)).toEqual([]);
    return bodyParagraphTexts(loadDocx(saveDocx(copy)));
}

/** Paragraph texts after reject-all on a reloaded copy; asserts no revisions remain. */
function rejectedTexts(file: ReturnType<typeof loadDocx>): string[] {
    const copy = loadDocx(saveDocx(file));
    rejectAllRevisions(copy);
    expect(listRevisions(copy)).toEqual([]);
    return bodyParagraphTexts(loadDocx(saveDocx(copy)));
}

/** The paragraph-mark revision markers (`ins`/`del`) on body paragraph `index`. */
function markMarkers(file: ReturnType<typeof loadDocx>, index: number): string[] {
    const xml = bodyXml(loadDocx(saveDocx(file)));
    const paragraphs = [...xml.matchAll(/<w:p>(.*?)<\/w:p>/gs)].map((m) => m[1]);
    const pPr = /<w:pPr>(.*?)<\/w:pPr>/s.exec(paragraphs[index] ?? '');
    if (!pPr) return [];
    const rPr = /<w:rPr>(.*?)<\/w:rPr>/s.exec(pPr[1]);
    if (!rPr) return [];
    return [...rPr[1].matchAll(/<w:(ins|del) /g)].map((m) => m[1]);
}

describe('adjacent whole-paragraph revisions', () => {
    it('accept-all removes two adjacent deleted paragraphs completely', () => {
        const file = docOf('A', 'B', 'C', 'D');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(1);
        editor.deleteParagraph(2);
        expect(acceptedTexts(file)).toEqual(['A', 'D']);
        expect(rejectedTexts(file)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('accept-all removes two adjacent deleted paragraphs whichever is deleted first', () => {
        const file = docOf('A', 'B', 'C', 'D');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(2);
        editor.deleteParagraph(1);
        expect(acceptedTexts(file)).toEqual(['A', 'D']);
        expect(rejectedTexts(file)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('reject-all removes two adjacent inserted paragraphs completely', () => {
        const file = docOf('A', 'B');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.insertParagraph(0, 'Y');
        editor.insertParagraph(0, 'X');
        expect(acceptedTexts(file)).toEqual(['A', 'X', 'Y', 'B']);
        expect(rejectedTexts(file)).toEqual(['A', 'B']);
    });

    it('a merge keeps the first paragraph\'s properties', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:pPr><w:pStyle w:val="First"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="Second"/></w:pPr><w:r><w:t>B</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(0);
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        const xml = bodyXml(loadDocx(saveDocx(copy)));
        expect(bodyParagraphTexts(copy)).toEqual(['B']);
        expect(xml).toContain('w:val="First"');
        expect(xml).not.toContain('w:val="Second"');
    });
});

describe('deleting the last paragraph of the document', () => {
    it('accept-all leaves no empty paragraph; the previous paragraph\'s mark carries the deletion', () => {
        const file = docOf('A', 'B');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(1);
        expect(markMarkers(file, 0)).toEqual(['del']);
        expect(markMarkers(file, 1)).toEqual([]);
        expect(acceptedTexts(file)).toEqual(['A']);
        expect(rejectedTexts(file)).toEqual(['A', 'B']);
    });

    it('deleting the last two paragraphs accepts to the first, in either order', () => {
        for (const order of [[1, 2], [2, 1]]) {
            const file = docOf('A', 'B', 'C');
            const editor = new TrackedChangesEditor(file, AUTHOR);
            for (const i of order) editor.deleteParagraph(i);
            expect(acceptedTexts(file)).toEqual(['A']);
            expect(rejectedTexts(file)).toEqual(['A', 'B', 'C']);
        }
    });

    it('deleting the only paragraph keeps its own mark deletion (nothing before it)', () => {
        const file = docOf('A');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(0);
        expect(markMarkers(file, 0)).toEqual(['del']);
        expect(acceptedTexts(file)).toEqual(['']);
        expect(rejectedTexts(file)).toEqual(['A']);
    });

    it('a trailing empty paragraph is not deleted content: deleting the one before it behaves as before', () => {
        const file = docOf('A', 'B', '');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(1);
        expect(markMarkers(file, 0)).toEqual([]);
        expect(markMarkers(file, 1)).toEqual(['del']);
        expect(acceptedTexts(file)).toEqual(['A', '']);
    });

    it('after a table, deleting the last paragraph behaves as before', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>A</w:t></w:r></w:p>
              <w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
              <w:p><w:r><w:t>B</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(2);
        expect(markMarkers(file, 2)).toEqual(['del']);
        expect(rejectedTexts(file)).toEqual(['A', 'cell', 'B']);
    });
});

describe('inserting after the last paragraph of the document', () => {
    it('reject-all leaves no empty paragraph; the anchor\'s mark carries the insertion', () => {
        const file = docOf('A', 'B');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.insertParagraph(1, 'X');
        expect(markMarkers(file, 1)).toEqual(['ins']);
        expect(markMarkers(file, 2)).toEqual([]);
        expect(acceptedTexts(file)).toEqual(['A', 'B', 'X']);
        expect(rejectedTexts(file)).toEqual(['A', 'B']);
    });

    it('several paragraphs after the last paragraph, inserted in either order', () => {
        const backwards = docOf('A', 'B');
        const e1 = new TrackedChangesEditor(backwards, AUTHOR);
        e1.insertParagraph(1, 'Y');
        e1.insertParagraph(1, 'X');
        expect(acceptedTexts(backwards)).toEqual(['A', 'B', 'X', 'Y']);
        expect(rejectedTexts(backwards)).toEqual(['A', 'B']);

        const forwards = docOf('A', 'B');
        const e2 = new TrackedChangesEditor(forwards, AUTHOR);
        e2.insertParagraph(1, 'X');
        e2.insertParagraph(2, 'Y');
        expect(acceptedTexts(forwards)).toEqual(['A', 'B', 'X', 'Y']);
        expect(rejectedTexts(forwards)).toEqual(['A', 'B']);
    });

    it('deleting the last paragraph and inserting after it, in either order', () => {
        const deleteFirst = docOf('A', 'B');
        const e1 = new TrackedChangesEditor(deleteFirst, AUTHOR);
        e1.deleteParagraph(1);
        e1.insertParagraph(1, 'X');
        expect(acceptedTexts(deleteFirst)).toEqual(['A', 'X']);
        expect(rejectedTexts(deleteFirst)).toEqual(['A', 'B']);

        const insertFirst = docOf('A', 'B');
        const e2 = new TrackedChangesEditor(insertFirst, AUTHOR);
        e2.insertParagraph(1, 'X');
        e2.deleteParagraph(1);
        expect(acceptedTexts(insertFirst)).toEqual(['A', 'X']);
        expect(rejectedTexts(insertFirst)).toEqual(['A', 'B']);
    });

    it('inserting after the last paragraph and then deleting the new paragraph leaves the original', () => {
        const file = docOf('A', 'B');
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.insertParagraph(1, 'X');
        editor.deleteParagraph(2);
        expect(acceptedTexts(file)).toEqual(['A', 'B']);
        expect(rejectedTexts(file)).toEqual(['A', 'B']);
    });
});

describe('revisions inside table cells', () => {
    const table = `
      <w:p><w:r><w:t>intro</w:t></w:r></w:p>
      <w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>c1</w:t></w:r></w:p><w:p><w:r><w:t>c2</w:t></w:r></w:p><w:p><w:r><w:t>c3</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>d1</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>
      <w:p><w:r><w:t>outro</w:t></w:r></w:p>
    `;

    it('accept-all and reject-all resolve a word-level change in a cell', () => {
        const file = loadDocx(buildBodyDocx(table));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(4, [
            { kind: 'delete', text: 'd1' },
            { kind: 'insert', text: 'e1' },
        ]);
        expect(acceptedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'e1', 'outro']);
        expect(rejectedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'd1', 'outro']);
    });

    it('accept-all removes a deleted cell paragraph without touching paragraphs outside the cell', () => {
        const file = loadDocx(buildBodyDocx(table));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(2);
        expect(acceptedTexts(file)).toEqual(['intro', 'c1', 'c3', 'd1', 'outro']);
        expect(rejectedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'd1', 'outro']);
    });

    it('deleting the last paragraph of a cell accepts with no empty paragraph left in the cell', () => {
        const file = loadDocx(buildBodyDocx(table));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(3);
        expect(acceptedTexts(file)).toEqual(['intro', 'c1', 'c2', 'd1', 'outro']);
        expect(rejectedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'd1', 'outro']);
    });

    it('deleting the only paragraph of a cell leaves the cell its (empty) paragraph', () => {
        const file = loadDocx(buildBodyDocx(table));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(4);
        expect(acceptedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', '', 'outro']);
        expect(rejectedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'd1', 'outro']);
    });

    it('inserted cell paragraphs reject cleanly, including after the cell\'s last paragraph', () => {
        const file = loadDocx(buildBodyDocx(table));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.insertParagraph(3, 'c4');
        editor.insertParagraph(1, 'c1b');
        expect(acceptedTexts(file)).toEqual(['intro', 'c1', 'c1b', 'c2', 'c3', 'c4', 'd1', 'outro']);
        expect(rejectedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'd1', 'outro']);
    });

    it('adjacent deleted cell paragraphs accept away completely', () => {
        const file = loadDocx(buildBodyDocx(table));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(1);
        editor.deleteParagraph(2);
        expect(acceptedTexts(file)).toEqual(['intro', 'c3', 'd1', 'outro']);
        expect(rejectedTexts(file)).toEqual(['intro', 'c1', 'c2', 'c3', 'd1', 'outro']);
    });
});
