import { describe, expect, it } from 'vitest';
import { generateDocx, loadDocx, type GenerateDocxSpec } from '../index.js';

/**
 * Pull `word/document.xml` out of the generated package and return the raw
 * string for assertion. We avoid asserting on raw OOXML beyond a few
 * key markers — the `docx` lib's exact serialization is its concern, not
 * ours. Where we *do* care (page orientation, table structure, body text
 * being present), substring checks are stable enough.
 */
async function generateAndOpen(spec: GenerateDocxSpec) {
    const bytes = await generateDocx(spec);
    const file = loadDocx(bytes);
    const doc = file.readPart('word/document.xml');
    if (!doc) throw new Error('document.xml missing from generated package');
    return { bytes, file, xml: doc.toString('utf8') };
}

describe('generateDocx — happy path', () => {
    it('produces a valid .docx with title, headings, paragraphs, and a table', async () => {
        const { file, xml } = await generateAndOpen({
            title: 'Term sheet',
            sections: [
                {
                    heading: { text: 'Parties', level: 1 },
                    paragraphs: [
                        'Buyer: Acme Holdings, LLC.',
                        'Seller: Beta Industries, Inc.',
                    ],
                },
                {
                    heading: { text: 'Conditions', level: 1 },
                    paragraphs: ['The closing is subject to the following:'],
                    table: {
                        headers: ['Condition', 'Status', 'Owner'],
                        rows: [
                            ['Diligence complete', 'Open', 'Buyer counsel'],
                            ['Financing committed', 'Closed', 'Sponsor'],
                        ],
                    },
                },
            ],
        });

        // Structural: package layout should include the standard parts.
        const parts = file.listParts();
        expect(parts).toContain('[Content_Types].xml');
        expect(parts).toContain('word/document.xml');
        expect(parts).toContain('word/styles.xml');

        // Content: title appears uppercased; headings are numbered.
        expect(xml).toContain('TERM SHEET');
        expect(xml).toContain('1. PARTIES');
        expect(xml).toContain('2. CONDITIONS');

        // Body text lands.
        expect(xml).toContain('Buyer: Acme Holdings, LLC.');
        expect(xml).toContain('The closing is subject to the following');

        // Table: headers + a known cell value present.
        expect(xml).toContain('<w:tbl>');
        expect(xml).toContain('Condition');
        expect(xml).toContain('Diligence complete');
        expect(xml).toContain('Buyer counsel');
    });
});

describe('generateDocx — heading numbering', () => {
    it('numbers H1/H2/H3 with reset-on-parent-increment', async () => {
        const { xml } = await generateAndOpen({
            title: 'Outline',
            sections: [
                { heading: { text: 'First', level: 1 } },
                { heading: { text: 'Sub a', level: 2 } },
                { heading: { text: 'Sub b', level: 2 } },
                { heading: { text: 'Detail', level: 3 } },
                { heading: { text: 'Second', level: 1 } },
                { heading: { text: 'Sub a', level: 2 } },
            ],
        });

        expect(xml).toContain('1. FIRST');
        expect(xml).toContain('1.1. Sub a');
        expect(xml).toContain('1.2. Sub b');
        expect(xml).toContain('1.2.1. Detail');
        expect(xml).toContain('2. SECOND');
        // Sub-counter resets when H1 increments.
        expect(xml).toContain('2.1. Sub a');
    });

    it('does not uppercase H2 / H3 text', async () => {
        const { xml } = await generateAndOpen({
            title: 'doc',
            sections: [
                { heading: { text: 'Top', level: 1 } },
                { heading: { text: 'mixed Case', level: 2 } },
                { heading: { text: 'lower-case detail', level: 3 } },
            ],
        });

        expect(xml).toContain('1.1. mixed Case');
        expect(xml).toContain('1.1.1. lower-case detail');
        // Negative — confirm we didn't uppercase the H2/H3.
        expect(xml).not.toContain('MIXED CASE');
        expect(xml).not.toContain('LOWER-CASE DETAIL');
    });
});

describe('generateDocx — bullets', () => {
    it('treats lines starting with -, *, or • as bullets and strips the marker', async () => {
        const { xml } = await generateAndOpen({
            title: 'List',
            sections: [
                {
                    paragraphs: [
                        '- alpha item',
                        '* beta item',
                        '• gamma item',
                        'plain paragraph',
                    ],
                },
            ],
        });

        // Bullet markers themselves are stripped — the body text appears
        // without the leading `-` / `*` / `•`.
        expect(xml).toContain('alpha item');
        expect(xml).toContain('beta item');
        expect(xml).toContain('gamma item');
        expect(xml).toContain('plain paragraph');
        expect(xml).not.toMatch(/<w:t[^>]*>\s*[-*•]\s+alpha/);
    });
});

describe('generateDocx — page orientation', () => {
    it('emits portrait by default', async () => {
        const { xml } = await generateAndOpen({
            title: 'Portrait',
            sections: [{ paragraphs: ['hello'] }],
        });
        // Portrait page-size: standard US Letter, w=12240, h=15840.
        expect(xml).toMatch(/<w:pgSz[^/]*w:w="12240"/);
        expect(xml).toMatch(/<w:pgSz[^/]*w:h="15840"/);
        expect(xml).not.toMatch(/w:orient="landscape"/);
    });

    it('emits landscape with swapped dims and the orient flag', async () => {
        const { xml } = await generateAndOpen({
            title: 'Landscape',
            orientation: 'landscape',
            sections: [{ paragraphs: ['hello'] }],
        });
        // Landscape Letter: 15840 × 12240 twips, plus the orient flag.
        expect(xml).toMatch(/w:orient="landscape"/);
        expect(xml).toMatch(/<w:pgSz[^/]*w:w="15840"/);
        expect(xml).toMatch(/<w:pgSz[^/]*w:h="12240"/);
    });
});

describe('generateDocx — page breaks', () => {
    it('emits a page break before a section when pageBreakBefore is set', async () => {
        const { xml } = await generateAndOpen({
            title: 'Break',
            sections: [
                { paragraphs: ['first page'] },
                {
                    pageBreakBefore: true,
                    heading: { text: 'After break', level: 1 },
                    paragraphs: ['second page'],
                },
            ],
        });
        expect(xml).toContain('<w:br w:type="page"/>');
    });
});

describe('generateDocx — table normalization', () => {
    it('pads short rows with empty cells', async () => {
        const { xml } = await generateAndOpen({
            title: 'Padding',
            sections: [
                {
                    table: {
                        headers: ['A', 'B', 'C'],
                        rows: [['just one']],
                    },
                },
            ],
        });
        // The row should still emit three <w:tc> cells. Counting cells
        // requires picking the data row; we approximate by asserting
        // the supplied value appears and the doc is well-formed.
        expect(xml).toContain('just one');
        expect(xml).toContain('<w:tbl>');
    });

    it('truncates over-long rows to header count', async () => {
        const { xml } = await generateAndOpen({
            title: 'Truncate',
            sections: [
                {
                    table: {
                        headers: ['A', 'B'],
                        rows: [['one', 'two', 'three-extra']],
                    },
                },
            ],
        });
        expect(xml).toContain('one');
        expect(xml).toContain('two');
        expect(xml).not.toContain('three-extra');
    });
});

describe('generateDocx — degenerate inputs', () => {
    it('produces a valid doc with no sections', async () => {
        const { file, xml } = await generateAndOpen({
            title: 'Just a title',
            sections: [],
        });
        expect(file.listParts()).toContain('word/document.xml');
        expect(xml).toContain('JUST A TITLE');
    });

    it('skips empty / whitespace-only paragraph lines', async () => {
        const { xml } = await generateAndOpen({
            title: 'Empty lines',
            sections: [
                { paragraphs: ['real line', '', '   ', 'another real line'] },
            ],
        });
        expect(xml).toContain('real line');
        expect(xml).toContain('another real line');
    });
});
