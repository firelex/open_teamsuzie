import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import {
    applyContentKeyedEdits,
    loadDocx,
    saveDocx,
} from '../index.js';
import type { RichRun } from '../index.js';

const AUTHOR = { name: 'Counsel', date: '2026-05-02T12:00:00Z' };

function buildDocx(paragraphs: string[]): Buffer {
    const xmlnsW =
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const ps = paragraphs
        .map(
            (text) =>
                `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
        )
        .join('');
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>${ps}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
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

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function bodyXml(file: ReturnType<typeof loadDocx>): string {
    return file.readPart('word/document.xml')!.toString('utf-8');
}

describe('applyContentKeyedEdits', () => {
    it('applies a single find/replace as tracked changes', () => {
        const file = loadDocx(
            buildDocx(['The Borrower shall pay interest at 5% per annum.']),
        );
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: '5%',
                    replace: '7%',
                    contextBefore: 'interest at ',
                    contextAfter: ' per annum',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
        expect(results[0].revisionIds.length).toBeGreaterThan(0);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('<w:delText xml:space="preserve">5</w:delText>');
        expect(xml).toContain('<w:t xml:space="preserve">7</w:t>');
        expect(xml).toContain('<w:t xml:space="preserve">%</w:t>');
    });

    it('refines paragraph-sized replacements into word-level tracked changes', () => {
        const original =
            'Receiving Party hereby acknowledges and agrees that in the event of any breach of this Agreement by it or its Representatives, the Company will suffer irreparable injury, such that no remedy at law will afford adequate protection against such injury.';
        const revised =
            'Each party acknowledges and agrees that in the event of any breach of this Agreement by it or its Representatives, the other party may suffer irreparable injury for which monetary damages would be inadequate.';
        const file = loadDocx(buildDocx([original]));

        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: original,
                    replace: revised,
                    contextBefore: '',
                    contextAfter: '',
                },
            ],
            AUTHOR,
        );

        expect(results[0].status).toBe('applied');
        expect(results[0].revisionIds.length).toBeGreaterThan(2);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('of this Agreement by it or its Representatives');
        expect(xml).not.toContain(
            `<w:delText xml:space="preserve">${escapeXml(original)}</w:delText>`,
        );
        expect(xml).toContain('<w:delText xml:space="preserve">Receiving Party hereby </w:delText>');
        expect(xml).toContain('<w:t xml:space="preserve">Each party </w:t>');
        expect(xml).toContain('<w:t xml:space="preserve">injury for which monetary damages would be inadequate</w:t>');
    });

    it('does not redline straight-vs-curly quote differences inside replacements', () => {
        const original =
            'Neither Receiving Party nor any affiliate acting at the Recipient’s or such affiliate’s instruction shall solicit the Company’s employees.';
        const revised =
            "Neither Receiving Party nor any affiliate acting at the Recipient's or such affiliate's instruction shall solicit the Company's senior executives.";
        const file = loadDocx(buildDocx([original]));

        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: original,
                    replace: revised,
                    contextBefore: '',
                    contextAfter: '',
                },
            ],
            AUTHOR,
        );

        expect(results[0].status).toBe('applied');
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).not.toContain('<w:delText xml:space="preserve">Recipient’s</w:delText>');
        expect(xml).not.toContain('<w:t xml:space="preserve">Recipient\'s</w:t>');
        expect(xml).not.toContain('<w:delText xml:space="preserve">affiliate’s</w:delText>');
        expect(xml).not.toContain('<w:t xml:space="preserve">affiliate\'s</w:t>');
        expect(xml).toContain('<w:delText xml:space="preserve">employees</w:delText>');
        expect(xml).toContain('<w:t xml:space="preserve">senior executives</w:t>');
    });

    it('rejects an edit whose find+context appears nowhere', () => {
        const file = loadDocx(buildDocx(['The Borrower shall pay 5%.']));
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: 'bogus',
                    replace: 'whatever',
                    contextBefore: '',
                    contextAfter: '',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('not_found');
    });

    it('rejects an ambiguous match (find+context occurs twice)', () => {
        const file = loadDocx(
            buildDocx([
                'The Borrower shall pay interest at 5% per annum on the principal.',
                'Furthermore, interest at 5% per annum applies to overdue amounts.',
            ]),
        );
        // "5%" preceded by "interest at " and followed by " per annum"
        // appears in both paragraphs.
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: '5%',
                    replace: '7%',
                    contextBefore: 'interest at ',
                    contextAfter: ' per annum',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('ambiguous');
        expect(results[0].reason).toContain('matched 2');
    });

    it('disambiguates two same-text edits via different contexts', () => {
        const file = loadDocx(
            buildDocx([
                'The Borrower shall pay interest at 5% per annum on the principal.',
                'Furthermore, interest at 5% per annum applies to overdue amounts.',
            ]),
        );
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: '5%',
                    replace: '7%',
                    contextBefore: 'shall pay interest at ',
                    contextAfter: ' per annum on',
                },
                {
                    find: '5%',
                    replace: '8%',
                    contextBefore: 'Furthermore, interest at ',
                    contextAfter: ' per annum applies',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
        expect(results[1].status).toBe('applied');
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('<w:t xml:space="preserve">7</w:t>');
        expect(xml).toContain('<w:t xml:space="preserve">8</w:t>');
        expect(xml.match(/<w:t xml:space="preserve">%<\/w:t>/g)?.length).toBe(2);
    });

    it('batches multiple edits in the same paragraph into one applyParagraphDiff', () => {
        const file = loadDocx(
            buildDocx([
                'The Borrower shall pay interest at 5% per annum to the Lender.',
            ]),
        );
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: 'Borrower',
                    replace: 'Buyer',
                    contextBefore: 'The ',
                    contextAfter: ' shall pay',
                },
                {
                    find: '5%',
                    replace: '7%',
                    contextBefore: 'interest at ',
                    contextAfter: ' per annum',
                },
                {
                    find: 'Lender',
                    replace: 'Seller',
                    contextBefore: 'to the ',
                    contextAfter: '.',
                },
            ],
            AUTHOR,
        );
        expect(results.map((r) => r.status)).toEqual([
            'applied',
            'applied',
            'applied',
        ]);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('Borrower');  // in delText
        expect(xml).toContain('Buyer');
        expect(xml).toContain('<w:delText xml:space="preserve">5</w:delText>');
        expect(xml).toContain('<w:t xml:space="preserve">%</w:t>');
        expect(xml).toContain('<w:t xml:space="preserve">7</w:t>');
        expect(xml).toContain('Lender');     // in delText
        expect(xml).toContain('Seller');
    });

    it('handles smart-quote normalization (’ → \')', () => {
        const file = loadDocx(
            buildDocx(['The Borrower’s obligations shall continue.']),
        );
        // Edit specifies straight quote; doc has smart quote — normalize matches.
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: "Borrower's",
                    replace: "Buyer's",
                    contextBefore: 'The ',
                    contextAfter: ' obligations',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
    });

    it('matches context across whitespace differences from markdown conversion', () => {
        const file = loadDocx(
            buildDocx([
                'All information directly or indirectly disclosed by the Company\n\tshall constitute Confidential Information.',
            ]),
        );
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: 'directly or indirectly disclosed',
                    replace: 'disclosed',
                    contextBefore: 'All information ',
                    contextAfter: ' by the Company shall constitute',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
    });

    it('falls back to a unique find match when converted context is imperfect', () => {
        const file = loadDocx(
            buildDocx([
                'The Recipient acknowledges that breach may cause irreparable harm.',
                'The parties agree Delaware law governs this Agreement.',
            ]),
        );
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: 'irreparable harm',
                    replace: 'harm not adequately compensable by money damages',
                    contextBefore: 'converted markdown omitted this prefix ',
                    contextAfter: ' and this suffix',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
    });

    it('supports a pure insertion (empty find)', () => {
        const file = loadDocx(buildDocx(['The Borrower shall pay.']));
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: '',
                    replace: 'promptly ',
                    contextBefore: 'shall ',
                    contextAfter: 'pay.',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('<w:t xml:space="preserve">promptly </w:t>');
    });

    it('rejects overlapping edits in the same paragraph', () => {
        const file = loadDocx(
            buildDocx(['The Borrower shall pay interest.']),
        );
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: 'Borrower shall',
                    replace: 'Buyer shall',
                    contextBefore: 'The ',
                    contextAfter: ' pay',
                },
                {
                    find: 'shall pay',
                    replace: 'shall promptly pay',
                    contextBefore: 'Borrower ',
                    contextAfter: ' interest',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
        expect(results[1].status).toBe('ambiguous');
        expect(results[1].reason).toContain('overlaps');
    });

    it('marks an edit with empty find AND empty replace as no_op', () => {
        const file = loadDocx(buildDocx(['hello']));
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: '',
                    replace: '',
                    contextBefore: '',
                    contextAfter: 'hello',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('no_op');
    });

    it('preserves untouched paragraphs end-to-end', () => {
        const file = loadDocx(
            buildDocx([
                'First paragraph stays the same.',
                'Second paragraph: pay 5% per annum.',
                'Third paragraph stays the same.',
            ]),
        );
        applyContentKeyedEdits(
            file,
            [
                {
                    find: '5%',
                    replace: '7%',
                    contextBefore: 'pay ',
                    contextAfter: ' per annum',
                },
            ],
            AUTHOR,
        );
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('First paragraph stays the same.');
        expect(xml).toContain('Third paragraph stays the same.');
    });

    it('replaceRuns: emits multiple styled runs for a replacement', () => {
        const file = loadDocx(
            buildDocx(['The Borrower shall pay interest.']),
        );
        const replaceRuns: RichRun[] = [
            { text: 'Buyer', bold: true },
            { text: ' (the "Obligor")', italic: true },
        ];
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: 'Borrower',
                    replace: 'Buyer (the "Obligor")',
                    replaceRuns,
                    contextBefore: 'The ',
                    contextAfter: ' shall',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
        const xml = bodyXml(loadDocx(saveDocx(file)));
        // The bold "Buyer" run has a <w:b/> in its rPr
        expect(xml).toMatch(/<w:rPr><w:b><\/w:b><\/w:rPr><w:t[^>]*>Buyer<\/w:t>/);
        // The italic run has a <w:i/> in its rPr (quotes may be XML-escaped)
        expect(xml).toMatch(/<w:rPr><w:i><\/w:i><\/w:rPr><w:t[^>]*> \(the (?:"|&quot;)Obligor(?:"|&quot;)\)<\/w:t>/);
        // The original "Borrower" is in a del wrapper
        expect(xml).toContain('<w:delText xml:space="preserve">Borrower</w:delText>');
    });

    it('replaceRuns: falls back gracefully when replaceRuns is absent (plain replace still works)', () => {
        const file = loadDocx(buildDocx(['Pay interest at 5%.']));
        const results = applyContentKeyedEdits(
            file,
            [
                {
                    find: '5%',
                    replace: '7%',
                    contextBefore: 'at ',
                    contextAfter: '.',
                },
            ],
            AUTHOR,
        );
        expect(results[0].status).toBe('applied');
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('<w:t xml:space="preserve">7</w:t>');
    });
});
