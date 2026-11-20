import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { DocxTemplateError, generateDocx, loadDocx, type GenerateDocxSpec } from '../index.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Paragraph and table styles, keyed by style id, each with the name Word shows. Ids deliberately differ from the
 *  names, so the tests prove styles are found by name. */
const FULL_STYLES: Record<string, { name: string; type?: 'table'; numId?: string }> = {
    MyTitle: { name: 'Title' },
    H1: { name: 'heading 1' },
    H2: { name: 'heading 2' },
    H3: { name: 'heading 3' },
    Body: { name: 'Body Text' },
    Bullets: { name: 'List Bullet', numId: '1' },
    Grid: { name: 'Table Grid', type: 'table' },
};

const LETTERHEAD_PARAGRAPH =
    '<w:p><w:r><w:drawing><wp:anchor><wp:wrapNone/><wps:txbx><w:txbxContent><w:p><w:r><w:t>[FIRM NAME]</w:t></w:r></w:p></w:txbxContent></wps:txbx></wp:anchor></w:drawing></w:r></w:p>';

function buildTemplate(opts: {
    styles?: typeof FULL_STYLES;
    body?: string;
    numbering?: boolean;
} = {}): Buffer {
    const styles = opts.styles ?? FULL_STYLES;
    const numbering = opts.numbering ?? true;
    const zip = new PizZip();
    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    );
    zip.file(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
        'word/_rels/document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
    );
    zip.file(
        'word/styles.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
            Object.entries(styles)
                .map(
                    ([id, s]) =>
                        `<w:style w:type="${s.type ?? 'paragraph'}" w:styleId="${id}"><w:name w:val="${s.name}"/>${s.numId ? `<w:pPr><w:numPr><w:numId w:val="${s.numId}"/></w:numPr></w:pPr>` : ''}</w:style>`,
                )
                .join('') +
            '</w:styles>',
    );
    zip.file(
        'word/numbering.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}">` +
            (numbering
                ? '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
                : '') +
            '</w:numbering>',
    );
    zip.file(
        'word/footer1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}"><w:p><w:r><w:t>TEMPLATE FOOTER</w:t></w:r></w:p></w:ftr>`,
    );
    zip.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>` +
            (opts.body ?? `${LETTERHEAD_PARAGRAPH}<w:p/>`) +
            '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>',
    );
    return zip.generate({ type: 'nodebuffer' });
}

async function fill(spec: Omit<GenerateDocxSpec, 'template'>, template = buildTemplate()) {
    const bytes = await generateDocx({ ...spec, template });
    const file = loadDocx(bytes);
    return { file, xml: file.readPart('word/document.xml')!.toString('utf8') };
}

function stylesOfParagraphsContaining(xml: string, text: string): string[] {
    return [...xml.matchAll(/<w:p>(?:(?!<\/w:p>).)*<\/w:p>/g)]
        .map((m) => m[0])
        .filter((p) => p.includes(text))
        .map((p) => p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '(none)');
}

describe('generateDocx with a template', () => {
    it("sets the content in the template's own styles, found by name", async () => {
        const { xml } = await fill({
            title: 'Advice memo',
            sections: [
                { heading: { text: 'Facts', level: 1 }, paragraphs: ['The client sold goods.', '- first point'] },
                { heading: { text: 'Detail', level: 2 } },
                { heading: { text: 'Fine detail', level: 3 } },
                { table: { headers: ['Step', 'Cost'], rows: [['File', 'CHF 100']] } },
            ],
        });
        expect(stylesOfParagraphsContaining(xml, 'ADVICE MEMO')).toEqual(['MyTitle']);
        expect(stylesOfParagraphsContaining(xml, '1. FACTS')).toEqual(['H1']);
        expect(stylesOfParagraphsContaining(xml, '1.1. Detail')).toEqual(['H2']);
        expect(stylesOfParagraphsContaining(xml, '1.1.1. Fine detail')).toEqual(['H3']);
        expect(stylesOfParagraphsContaining(xml, 'The client sold goods.')).toEqual(['Body']);
        expect(stylesOfParagraphsContaining(xml, 'first point')).toEqual(['Bullets']);
        expect(xml).not.toContain('- first point');
        expect(xml).toContain('<w:tblStyle w:val="Grid"');
        expect(stylesOfParagraphsContaining(xml, 'CHF 100')).toEqual(['Body']);
        // No direct fonts: the template's styles decide them.
        expect(xml).not.toContain('w:rFonts');
    });

    it('keeps the template parts, the section settings and the letterhead drawing; drops empty paragraphs', async () => {
        const template = buildTemplate();
        const { file, xml } = await fill({ title: 'Letter', sections: [{ paragraphs: ['Dear client,'] }] }, template);
        const source = loadDocx(template);
        for (const part of ['word/styles.xml', 'word/numbering.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels']) {
            expect(file.readPart(part)!.equals(source.readPart(part)!)).toBe(true);
        }
        expect(xml).toContain('<w:footerReference w:type="default" r:id="rId3"');
        expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"');
        expect(xml).toContain('<w:pgMar w:top="1440"');
        // The letterhead comes first, then the title; the template's empty paragraph is gone.
        expect(xml.indexOf('[FIRM NAME]')).toBeGreaterThan(-1);
        expect(xml.indexOf('[FIRM NAME]')).toBeLessThan(xml.indexOf('LETTER'));
        expect(xml).not.toMatch(/<w:p\/>|<w:p><\/w:p>/);
        expect(xml.indexOf('Dear client,')).toBeLessThan(xml.indexOf('<w:sectPr'));
    });

    it('names the missing style and never substitutes another one', async () => {
        const { Bullets: _bullets, ...withoutBullets } = FULL_STYLES;
        const template = buildTemplate({ styles: withoutBullets });
        await expect(fill({ title: 'T', sections: [{ paragraphs: ['- a bullet'] }] }, template)).rejects.toThrow(
            new DocxTemplateError('The template has no paragraph style named "List Bullet", which the content needs.'),
        );
        // Content that needs no bullets still fills it.
        await expect(fill({ title: 'T', sections: [{ paragraphs: ['prose'] }] }, template)).resolves.toBeDefined();

        const { Grid: _grid, ...withoutGrid } = FULL_STYLES;
        await expect(
            fill({ title: 'T', sections: [{ table: { headers: ['a'], rows: [] } }] }, buildTemplate({ styles: withoutGrid })),
        ).rejects.toThrow('no table style named "Table Grid"');

        const { MyTitle: _title, ...withoutTitle } = FULL_STYLES;
        await expect(fill({ title: 'T', sections: [] }, buildTemplate({ styles: withoutTitle }))).rejects.toThrow('"Title"');
    });

    it('refuses a list style whose numbering the template does not define', async () => {
        await expect(
            fill({ title: 'T', sections: [{ paragraphs: ['- a bullet'] }] }, buildTemplate({ numbering: false })),
        ).rejects.toThrow('style "List Bullet" uses list numbering 1');
    });

    it('refuses a template whose body holds text', async () => {
        await expect(
            fill({ title: 'T', sections: [] }, buildTemplate({ body: '<w:p><w:r><w:t>Sample clause</w:t></w:r></w:p>' })),
        ).rejects.toThrow('The template body holds the text "Sample clause"');
    });

    it('turns the page for landscape by swapping the template page size', async () => {
        const { xml } = await fill({ title: 'Checklist', orientation: 'landscape', sections: [] });
        expect(xml).toMatch(/<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/);
    });

    it('escapes markup characters and turns line breaks and tabs into Word breaks', async () => {
        const { xml } = await fill({ title: 'A & B', sections: [{ paragraphs: ['x < y & z\nsecond line\tafter tab'] }] });
        expect(xml).toContain('A &amp; B');
        expect(xml).toContain('x &lt; y &amp; z');
        expect(xml).toMatch(/x &lt; y &amp; z<\/w:t><w:br\/?>(<\/w:br>)?<w:t xml:space="preserve">second line<\/w:t><w:tab\/?>(<\/w:tab>)?<w:t/);
    });

    it('drops a number the writer put before a heading, and turns Markdown bold and italic into formatting', async () => {
        const { stripHeadingMarks, emphasisPieces } = await import('../template-fill.js');
        expect(stripHeadingMarks('1. Summary of our advice')).toBe('Summary of our advice');
        expect(stripHeadingMarks('## 2.3 **Risks**')).toBe('Risks');
        expect(stripHeadingMarks('IV. Costs')).toBe('Costs');
        expect(stripHeadingMarks('2026 outlook')).toBe('2026 outlook');
        expect(emphasisPieces('**Step 1 – Check.** We *first* check 2 * 3.')).toEqual([
            { text: 'Step 1 – Check.', bold: true, italic: false },
            { text: ' We ', bold: false, italic: false },
            { text: 'first', bold: false, italic: true },
            { text: ' check 2 * 3.', bold: false, italic: false },
        ]);
    });
});
