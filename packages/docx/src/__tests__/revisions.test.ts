import { describe, expect, it } from 'vitest';
import {
    TrackedChangesEditor,
    acceptAllRevisions,
    acceptRevision,
    bodyParagraphInfos,
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

    it('accepting a whole deleted paragraph leaves the next paragraph its own properties', () => {
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
        expect(xml).toContain('w:val="Second"');
        expect(xml).not.toContain('w:val="First"');
    });

    it('a partial merge (the first paragraph keeps text) keeps the first paragraph\'s properties', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:pPr><w:pStyle w:val="First"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="Second"/></w:pPr><w:r><w:t>B</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        // Delete the second (last) paragraph: Word records it on the first paragraph's mark.
        editor.deleteParagraph(1);
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        const xml = bodyXml(loadDocx(saveDocx(copy)));
        expect(bodyParagraphTexts(copy)).toEqual(['A']);
        expect(xml).toContain('w:val="First"');
        expect(xml).not.toContain('w:val="Second"');
    });

    it('deleting the last body paragraph before a heading leaves the heading\'s style and numbering intact', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Term</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Body one.</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Body two.</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Law</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>English law.</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(2);
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        expect(bodyParagraphTexts(copy)).toEqual(['Term', 'Body one.', 'Law', 'English law.']);
        const infos = bodyParagraphInfos(copy);
        expect(JSON.stringify(infos[2].pPr)).toContain('Heading1');
        expect(JSON.stringify(infos[2].pPr)).toContain('w:numId');
        expect(JSON.stringify(infos[1].pPr)).toContain('BodyText');
    });

    it('deleting a heading before a body paragraph leaves the body paragraph its own style', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Term</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Body one.</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(0);
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        expect(bodyParagraphTexts(copy)).toEqual(['Body one.']);
        const pPr = JSON.stringify(bodyParagraphInfos(copy)[0].pPr);
        expect(pPr).toContain('BodyText');
        expect(pPr).not.toContain('Heading1');
    });
});

describe('a deleted paragraph directly before a table', () => {
    const tableXml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

    it('accept-all removes a deleted paragraph with text and keeps every other paragraph in order', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>A</w:t></w:r></w:p>
              <w:p><w:r><w:t>B</w:t></w:r></w:p>
              ${tableXml}
              <w:p><w:r><w:t>C</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(1);
        expect(acceptedTexts(file)).toEqual(['A', 'cell', 'C']);
        expect(rejectedTexts(file)).toEqual(['A', 'B', 'cell', 'C']);
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        const xml = bodyXml(loadDocx(saveDocx(copy)));
        expect(xml.indexOf('</w:tbl>')).toBeLessThan(xml.indexOf('>C<'));
    });

    it('accept-all removes an empty spacer paragraph whose mark alone is deleted', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>A</w:t></w:r></w:p>
              <w:p/>
              ${tableXml}
              <w:p><w:r><w:t>C</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(1);
        expect(acceptedTexts(file)).toEqual(['A', 'cell', 'C']);
        expect(rejectedTexts(file)).toEqual(['A', '', 'cell', 'C']);
    });

    it('reject-all removes an inserted paragraph directly before a table', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>A</w:t></w:r></w:p>
              ${tableXml}
              <w:p><w:r><w:t>C</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.insertParagraph(0, 'X');
        expect(acceptedTexts(file)).toEqual(['A', 'X', 'cell', 'C']);
        expect(rejectedTexts(file)).toEqual(['A', 'cell', 'C']);
    });

    it('a paragraph with text left whose deleted mark sits before a table just loses the marker', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:pPr><w:rPr><w:del w:id="9" w:author="X" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p>
              ${tableXml}
              <w:p><w:r><w:t>C</w:t></w:r></w:p>
            `),
        );
        expect(acceptedTexts(file)).toEqual(['A', 'cell', 'C']);
    });

    it('inside a cell, a deleted paragraph before a nested table is removed and nothing moves', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:tbl><w:tr><w:tc>
                <w:p><w:r><w:t>c1</w:t></w:r></w:p>
                ${tableXml}
                <w:p><w:r><w:t>c2</w:t></w:r></w:p>
              </w:tc></w:tr></w:tbl>
              <w:p><w:r><w:t>after</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.deleteParagraph(0);
        expect(acceptedTexts(file)).toEqual(['cell', 'c2', 'after']);
        expect(rejectedTexts(file)).toEqual(['c1', 'cell', 'c2', 'after']);
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

// Word gives a paragraph's mark revision and its text revision DIFFERENT ids.
describe('Word-authored whole-paragraph revisions (distinct ids for the mark and the text)', () => {
    const tableXml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const by = 'w:author="Them" w:date="2026-01-01T00:00:00Z"';
    const deletedP = (markId: number, textId: number, text: string) =>
        `<w:p><w:pPr><w:rPr><w:del w:id="${markId}" ${by}/></w:rPr></w:pPr><w:del w:id="${textId}" ${by}><w:r><w:delText>${text}</w:delText></w:r></w:del></w:p>`;
    const insertedP = (markId: number, textId: number, text: string) =>
        `<w:p><w:pPr><w:rPr><w:ins w:id="${markId}" ${by}/></w:rPr></w:pPr><w:ins w:id="${textId}" ${by}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
    const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

    it('accept-all removes a deleted paragraph directly before a table', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${deletedP(1, 2, 'B')}${tableXml}${p('C')}`));
        expect(acceptedTexts(file)).toEqual(['A', 'cell', 'C']);
        expect(rejectedTexts(file)).toEqual(['A', 'B', 'cell', 'C']);
    });

    it('reject-all removes an inserted paragraph directly before a table', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${insertedP(1, 2, 'X')}${tableXml}${p('C')}`));
        expect(rejectedTexts(file)).toEqual(['A', 'cell', 'C']);
        expect(acceptedTexts(file)).toEqual(['A', 'X', 'cell', 'C']);
    });

    it('accept-all removes adjacent deleted paragraphs, and reject-all adjacent inserted ones, with no table near', () => {
        const deleted = loadDocx(buildBodyDocx(`${p('A')}${deletedP(1, 2, 'B')}${deletedP(3, 4, 'C')}${p('D')}`));
        expect(acceptedTexts(deleted)).toEqual(['A', 'D']);
        expect(rejectedTexts(deleted)).toEqual(['A', 'B', 'C', 'D']);
        const inserted = loadDocx(buildBodyDocx(`${p('A')}${insertedP(1, 2, 'X')}${insertedP(3, 4, 'Y')}${p('B')}`));
        expect(rejectedTexts(inserted)).toEqual(['A', 'B']);
        expect(acceptedTexts(inserted)).toEqual(['A', 'X', 'Y', 'B']);
    });

    it('a whole deleted paragraph leaves the next paragraph its own properties', () => {
        const file = loadDocx(
            buildBodyDocx(
                `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:del w:id="1" ${by}/></w:rPr></w:pPr><w:del w:id="2" ${by}><w:r><w:delText>Old heading</w:delText></w:r></w:del></w:p>` +
                    `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Body.</w:t></w:r></w:p>`,
            ),
        );
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        expect(bodyParagraphTexts(copy)).toEqual(['Body.']);
        expect(JSON.stringify(bodyParagraphInfos(copy)[0].pPr)).toContain('BodyText');
    });

    it('one id at a time, mark first: accepting the mark deletion before a table keeps the paragraph while its text is undecided', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${deletedP(1, 2, 'B')}${tableXml}${p('C')}`));
        expect(acceptRevision(file, 1)).toBe(true);
        // The deleted text is still pending, so the paragraph stays (it reads empty in accepted view).
        expect(bodyParagraphTexts(file)).toEqual(['A', '', 'cell', 'C']);
        expect(listRevisions(file).map((r) => r.id)).toEqual([2]);
        // Accepting the text too leaves the documented limitation: an empty paragraph, nothing lost.
        expect(acceptRevision(file, 2)).toBe(true);
        expect(bodyParagraphTexts(file)).toEqual(['A', '', 'cell', 'C']);
    });

    it('one id at a time: accepting the mark deletion then rejecting the text keeps "B"', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${deletedP(1, 2, 'B')}${tableXml}${p('C')}`));
        expect(acceptRevision(file, 1)).toBe(true);
        expect(rejectRevision(file, 2)).toBe(true);
        expect(bodyParagraphTexts(file)).toEqual(['A', 'B', 'cell', 'C']);
        expect(listRevisions(file)).toEqual([]);
    });

    it('one id at a time: rejecting the inserted mark then accepting the text keeps "X"', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${insertedP(1, 2, 'X')}${tableXml}${p('C')}`));
        expect(rejectRevision(file, 1)).toBe(true);
        expect(acceptRevision(file, 2)).toBe(true);
        expect(bodyParagraphTexts(file)).toEqual(['A', 'X', 'cell', 'C']);
        expect(listRevisions(file)).toEqual([]);
    });

    it('a batch that accepts before it rejects (as the redline router does) acts on both ids and loses no text', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${deletedP(1, 2, 'B')}${tableXml}${p('C')}`));
        const batch = { accept: [1], reject: [2] };
        const accepted: number[] = [];
        const rejected: number[] = [];
        for (const id of batch.accept) if (acceptRevision(file, id)) accepted.push(id);
        for (const id of batch.reject) if (rejectRevision(file, id)) rejected.push(id);
        expect({ accepted, rejected }).toEqual({ accepted: [1], rejected: [2] });
        expect(bodyParagraphTexts(loadDocx(saveDocx(file)))).toEqual(['A', 'B', 'cell', 'C']);
    });

    it('one id at a time, text first: accepting the text then the mark removes the paragraph', () => {
        const file = loadDocx(buildBodyDocx(`${p('A')}${deletedP(1, 2, 'B')}${tableXml}${p('C')}`));
        acceptRevision(file, 2);
        expect(bodyParagraphTexts(file)).toEqual(['A', '', 'cell', 'C']);
        acceptRevision(file, 1);
        expect(bodyParagraphTexts(file)).toEqual(['A', 'cell', 'C']);
    });

    it('removing an emptied paragraph before a table keeps its bookmarks in place', () => {
        const file = loadDocx(
            buildBodyDocx(
                `${p('A')}<w:p><w:pPr><w:rPr><w:del w:id="1" ${by}/></w:rPr></w:pPr><w:bookmarkStart w:id="0" w:name="here"/><w:del w:id="2" ${by}><w:r><w:delText>B</w:delText></w:r></w:del><w:bookmarkEnd w:id="0"/></w:p>${tableXml}${p('C')}`,
            ),
        );
        const copy = loadDocx(saveDocx(file));
        acceptAllRevisions(copy);
        expect(bodyParagraphTexts(copy)).toEqual(['A', 'cell', 'C']);
        const xml = bodyXml(loadDocx(saveDocx(copy)));
        expect(xml).toContain('w:name="here"');
        expect(xml.indexOf('w:name="here"')).toBeLessThan(xml.indexOf('<w:tbl>'));
    });
});
