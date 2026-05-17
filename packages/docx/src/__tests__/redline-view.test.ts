import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { extractRedlineParagraphs } from '../redline-view.js';

/**
 * Wrap an inner `<w:body>` snippet in a minimal Word-readable .docx
 * package. Matches the fixture pattern used by `tracked-changes.test.ts`
 * but stays local because the formatting cases here don't need the
 * full helper surface.
 */
function buildBodyDocx(bodyInner: string): Buffer {
    const xmlnsW =
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>${bodyInner}</w:body>
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

describe('extractRedlineParagraphs — run formatting', () => {
    it('marks a run carrying <w:rPr><w:b/></w:rPr> as bold and leaves a plain run unmarked', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold</w:t></w:r>
            <w:r><w:t xml:space="preserve"> text</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].runs).toEqual([
            { kind: 'equal', text: 'bold', bold: true },
            { kind: 'equal', text: ' text' },
        ]);
    });

    it('marks italic via <w:i/> and supports combined bold + italic', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>
            <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>both</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs[0].runs).toEqual([
            { kind: 'equal', text: 'italic', italic: true },
            { kind: 'equal', text: 'both', bold: true, italic: true },
        ]);
    });

    it('treats <w:b w:val="0"/> and <w:b w:val="false"/> as NOT bold', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>not bold zero</w:t></w:r>
            <w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>not bold false</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        // Both runs collapse to the same kind/no-formatting bucket and
        // coalesce into one merged run.
        expect(paragraphs[0].runs).toEqual([
            { kind: 'equal', text: 'not bold zeronot bold false' },
        ]);
    });

    it('propagates bold/italic through <w:ins> wrappers (insert runs keep their rPr)', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:r><w:t xml:space="preserve">before </w:t></w:r>
            <w:ins w:id="100" w:author="X" w:date="2026-01-01T00:00:00Z">
              <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold inserted</w:t></w:r>
            </w:ins>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs[0].runs).toEqual([
            { kind: 'equal', text: 'before ' },
            {
                kind: 'insert',
                text: 'bold inserted',
                revisionId: 100,
                bold: true,
            },
        ]);
    });

    it('does not coalesce adjacent runs that differ only in bold flag', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:r><w:t>plain</w:t></w:r>
            <w:r><w:rPr><w:b/></w:rPr><w:t>BOLD</w:t></w:r>
            <w:r><w:t>plain again</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs[0].runs).toEqual([
            { kind: 'equal', text: 'plain' },
            { kind: 'equal', text: 'BOLD', bold: true },
            { kind: 'equal', text: 'plain again' },
        ]);
    });
});

describe('extractRedlineParagraphs — paragraph style', () => {
    it('maps <w:pStyle w:val="Heading2"/> to style: "heading2"', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
            <w:r><w:t>Section title</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].style).toBe('heading2');
        expect(paragraphs[0].runs).toEqual([
            { kind: 'equal', text: 'Section title' },
        ]);
    });

    it('is case- and separator-tolerant: "heading 1" and "Heading-3" map correctly', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:pPr><w:pStyle w:val="heading 1"/></w:pPr>
            <w:r><w:t>title</w:t></w:r>
          </w:p>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading-3"/></w:pPr>
            <w:r><w:t>sub-sub</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs[0].style).toBe('heading1');
        expect(paragraphs[1].style).toBe('heading3');
    });

    it('omits style on a normal paragraph (no <w:pStyle>)', () => {
        const bytes = buildBodyDocx(`
          <w:p><w:r><w:t>body text</w:t></w:r></w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs[0].style).toBeUndefined();
    });

    it('collapses Heading4+ and unrecognized styles to omitted (normal)', () => {
        const bytes = buildBodyDocx(`
          <w:p>
            <w:pPr><w:pStyle w:val="Heading4"/></w:pPr>
            <w:r><w:t>deep</w:t></w:r>
          </w:p>
          <w:p>
            <w:pPr><w:pStyle w:val="Caption"/></w:pPr>
            <w:r><w:t>cap</w:t></w:r>
          </w:p>
        `);
        const paragraphs = extractRedlineParagraphs(bytes);
        expect(paragraphs[0].style).toBeUndefined();
        expect(paragraphs[1].style).toBeUndefined();
    });
});
