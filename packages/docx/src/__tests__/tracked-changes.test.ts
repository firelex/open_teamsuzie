import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import {
    TrackedChangesEditor,
    bodyParagraphInfos,
    bodyParagraphTexts,
    computeNextRevisionId,
    listRevisions,
    loadDocx,
    parseXml,
    saveDocx,
} from '../index.js';
import { buildMinimalDocx } from './fixtures.js';

const AUTHOR = { name: 'Counsel', date: '2026-05-02T12:00:00Z' };

function bodyXml(file: ReturnType<typeof loadDocx>): string {
    return file.readPart('word/document.xml')!.toString('utf-8');
}

describe('bodyParagraphTexts', () => {
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

    it('returns empty array for an empty body', () => {
        const file = loadDocx(buildBodyDocx(''));
        expect(bodyParagraphTexts(file)).toEqual([]);
    });

    it('preserves empty paragraphs as empty strings (count parity with body indices)', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>first</w:t></w:r></w:p>
              <w:p/>
              <w:p><w:r><w:t>third</w:t></w:r></w:p>
              <w:p/>
              <w:p><w:r><w:t>fifth</w:t></w:r></w:p>
            `),
        );
        expect(bodyParagraphTexts(file)).toEqual([
            'first',
            '',
            'third',
            '',
            'fifth',
        ]);
    });

    it('concatenates multiple <w:t> children within a run', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:r>
                  <w:t xml:space="preserve">Hello </w:t>
                  <w:t>world</w:t>
                </w:r>
              </w:p>
            `),
        );
        expect(bodyParagraphTexts(file)).toEqual(['Hello world']);
    });

    it('concatenates multiple runs within a paragraph', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:r><w:rPr><w:b/></w:rPr><w:t>The </w:t></w:r>
                <w:r><w:t>Borrower</w:t></w:r>
                <w:r><w:t xml:space="preserve"> shall pay.</w:t></w:r>
              </w:p>
            `),
        );
        expect(bodyParagraphTexts(file)).toEqual([
            'The Borrower shall pay.',
        ]);
    });

    it('ignores <w:tab> and <w:br> (not part of the text stream)', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:r>
                  <w:t xml:space="preserve">left</w:t>
                  <w:tab/>
                  <w:t xml:space="preserve">right</w:t>
                  <w:br/>
                  <w:t>line2</w:t>
                </w:r>
              </w:p>
            `),
        );
        expect(bodyParagraphTexts(file)).toEqual(['leftrightline2']);
    });

    it('treats existing <w:ins> as part of the visible text (accepted view)', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:r><w:t xml:space="preserve">before </w:t></w:r>
                <w:ins w:id="100" w:author="X" w:date="2026-01-01T00:00:00Z">
                  <w:r><w:t xml:space="preserve">inserted </w:t></w:r>
                </w:ins>
                <w:r><w:t>after</w:t></w:r>
              </w:p>
            `),
        );
        expect(bodyParagraphTexts(file)).toEqual([
            'before inserted after',
        ]);
    });

    it('skips existing <w:del> entirely (accepted view drops deletions)', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:r><w:t xml:space="preserve">live </w:t></w:r>
                <w:del w:id="200" w:author="X" w:date="2026-01-01T00:00:00Z">
                  <w:r><w:delText xml:space="preserve">deleted </w:delText></w:r>
                </w:del>
                <w:r><w:t>tail</w:t></w:r>
              </w:p>
            `),
        );
        expect(bodyParagraphTexts(file)).toEqual(['live tail']);
    });

    it('aligns 1:1 with TrackedChangesEditor.bodyParagraphCount', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>a</w:t></w:r></w:p>
              <w:p/>
              <w:p><w:r><w:t>c</w:t></w:r></w:p>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        expect(bodyParagraphTexts(file)).toHaveLength(
            editor.bodyParagraphCount(),
        );
    });
});

describe('bodyParagraphInfos', () => {
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

    it('returns text + pPr clone + first-run rPr clone per paragraph', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>
                <w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>bullet item</w:t></w:r>
              </w:p>
              <w:p><w:r><w:t>plain</w:t></w:r></w:p>
            `),
        );
        const infos = bodyParagraphInfos(file);
        expect(infos).toHaveLength(2);

        expect(infos[0].text).toBe('bullet item');
        expect(JSON.stringify(infos[0].pPr)).toContain('ListBullet');
        expect(JSON.stringify(infos[0].pPr)).toContain('numId');
        expect(JSON.stringify(infos[0].firstRunRPr)).toContain('w:b');
        expect(JSON.stringify(infos[0].firstRunRPr)).toContain('"24"');

        expect(infos[1].text).toBe('plain');
        expect(infos[1].pPr).toBeNull();
        expect(infos[1].firstRunRPr).toBeNull();
    });

    it('returns deep clones (mutation does not leak back into the source tree)', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p>
                <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
                <w:r><w:t>hello</w:t></w:r>
              </w:p>
            `),
        );
        const infos = bodyParagraphInfos(file);
        // Mutate the returned pPr
        const pPr = infos[0].pPr as Record<string, unknown>;
        const inner = pPr['w:pPr'] as Record<string, unknown>[];
        inner.length = 0; // wipe
        // Re-extract: original tree is unchanged
        const fresh = bodyParagraphInfos(file);
        expect(JSON.stringify(fresh[0].pPr)).toContain('Heading1');
    });

    it('aligns 1:1 with bodyParagraphTexts', () => {
        const file = loadDocx(
            buildBodyDocx(`
              <w:p><w:r><w:t>a</w:t></w:r></w:p>
              <w:p/>
              <w:p><w:r><w:t>c</w:t></w:r></w:p>
            `),
        );
        const infos = bodyParagraphInfos(file);
        const texts = bodyParagraphTexts(file);
        expect(infos.map((i) => i.text)).toEqual(texts);
    });
});

describe('TrackedChangesEditor.insertParagraph with opts.rPr', () => {
    it('applies the inherited run rPr to the inserted content run', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'first' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const rPr = {
            'w:rPr': [
                { 'w:b': [] } as never,
                {
                    'w:sz': [],
                    ':@': { '@_w:val': '28' } as never,
                },
            ],
        };
        editor.insertParagraph(0, 'big bold insertion', { rPr });
        const out = bodyXml(loadDocx(saveDocx(file)));
        // The inserted run carries the b + sz=28 rPr
        expect(out).toMatch(
            /<w:ins [^>]+><w:r><w:rPr><w:b><\/w:b><w:sz w:val="28"><\/w:sz><\/w:rPr><w:t [^>]*>big bold insertion<\/w:t><\/w:r><\/w:ins>/,
        );
    });
});

describe('TrackedChangesEditor.applyParagraphDiff', () => {
    it('emits a w:del + w:ins around a swapped digit (5 → 7)', () => {
        const file = loadDocx(
            buildMinimalDocx([
                { text: 'The Borrower shall pay interest at 5% per annum.' },
            ]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(0, [
            { kind: 'equal', text: 'The Borrower shall pay interest at ' },
            { kind: 'delete', text: '5' },
            { kind: 'insert', text: '7' },
            { kind: 'equal', text: '% per annum.' },
        ]);
        const xml = bodyXml(loadDocx(saveDocx(file)));
        expect(xml).toContain('<w:ins');
        expect(xml).toContain('<w:del');
        expect(xml).toContain('w:author="Counsel"');
        expect(xml).toContain('w:date="2026-05-02T12:00:00Z"');
        // The literal "5" survives as a w:delText leaf, "7" as a w:t leaf.
        expect(xml).toContain('<w:delText xml:space="preserve">5</w:delText>');
        expect(xml).toContain('<w:t xml:space="preserve">7</w:t>');
    });

    it('preserves <w:pPr> on a modified paragraph (heading stays a heading)', () => {
        // Hand-build a doc with a heading-styled paragraph
        const xmlnsW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const richDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Old heading text</w:t></w:r>
    </w:p>
  </w:body>
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
        zip.file('word/document.xml', richDoc);
        const file = loadDocx(zip.generate({ type: 'nodebuffer' }));

        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'Old heading text' },
            { kind: 'insert', text: 'New heading text' },
        ]);
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Heading style preserved
        expect(out).toContain('<w:pStyle w:val="Heading1"');
        // Tracked changes present
        expect(out).toContain('<w:ins');
        expect(out).toContain('<w:del');
    });

    it('every revision gets a unique w:id starting above existing ids', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'Hello world' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const ids = editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'Hello' },
            { kind: 'insert', text: 'Goodbye' },
            { kind: 'equal', text: ' world' },
        ]);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        // Re-running on the same file allocates further-up ids.
        const moreIds = editor.applyParagraphDiff(0, [
            { kind: 'equal', text: 'Goodbye' },
            { kind: 'delete', text: ' world' },
            { kind: 'insert', text: ' moon' },
        ]);
        const all = [...ids, ...moreIds];
        expect(new Set(all).size).toBe(all.length);
    });

    it('rejects an out-of-range paragraph index', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'one' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        expect(() =>
            editor.applyParagraphDiff(5, [{ kind: 'insert', text: 'x' }]),
        ).toThrow(/out of range/);
    });
});

describe('TrackedChangesEditor.applyParagraphDiff with inheritFormatting', () => {
    it('copies the first existing run\'s w:rPr onto every generated run', () => {
        // Build a paragraph whose runs carry size + bold formatting.
        const xmlnsW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const richDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p>
      <w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>The Borrower shall pay 5%.</w:t></w:r>
    </w:p>
  </w:body>
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
        zip.file('word/document.xml', richDoc);
        const file = loadDocx(zip.generate({ type: 'nodebuffer' }));

        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(
            0,
            [
                { kind: 'equal', text: 'The Borrower shall pay ' },
                { kind: 'delete', text: '5' },
                { kind: 'insert', text: '7' },
                { kind: 'equal', text: '%.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // pPr (paragraph spacing) survives unchanged
        expect(out).toContain('<w:spacing w:line="200" w:lineRule="exact"');
        // Every generated run carries the inherited bold + size 24 rPr
        const rPrs = out.match(/<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>/gs) ?? [];
        expect(rPrs.length).toBeGreaterThan(0);
        // All non-pPr-internal rPrs should match the inherited shape
        const inheritedShape = '<w:rPr><w:b></w:b><w:sz w:val="24"></w:sz></w:rPr>';
        const matchingCount = rPrs.filter((r) => r === inheritedShape).length;
        // 4 generated runs — equal, delete, insert, equal — each gets the rPr
        expect(matchingCount).toBe(4);
    });

    it('default (no opts) still produces plain runs (backward compat)', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'Hello world' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'Hello' },
            { kind: 'insert', text: 'Goodbye' },
            { kind: 'equal', text: ' world' },
        ]);
        const out = bodyXml(loadDocx(saveDocx(file)));
        // No bold or size attribute on generated runs
        expect(out).not.toContain('<w:b/>');
        expect(out).not.toContain('<w:sz');
    });
});

describe('TrackedChangesEditor.applyParagraphDiff with run-splitting', () => {
    function buildMultiRunDocx(): Buffer {
        const xmlnsW =
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const richDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p>
      <w:pPr><w:spacing w:line="240" w:lineRule="exact"/></w:pPr>
      <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">The </w:t></w:r>
      <w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t>Borrower</w:t></w:r>
      <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> shall pay 5%.</w:t></w:r>
    </w:p>
  </w:body>
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
        zip.file('word/document.xml', richDoc);
        return zip.generate({ type: 'nodebuffer' });
    }

    it('preserves bold-mid-paragraph run formatting on a digit swap (5 → 7)', () => {
        const file = loadDocx(buildMultiRunDocx());
        const editor = new TrackedChangesEditor(file, AUTHOR);
        // OOXML run-text concatenation: "The Borrower shall pay 5%."
        // Diff text matches → run-splitting should fire.
        editor.applyParagraphDiff(
            0,
            [
                { kind: 'equal', text: 'The Borrower shall pay ' },
                { kind: 'delete', text: '5' },
                { kind: 'insert', text: '7' },
                { kind: 'equal', text: '%.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // The bold "Borrower" word should have been preserved as a run with
        // its <w:b/> rPr — not flattened to "all runs use first-run rPr".
        expect(out).toMatch(
            /<w:r><w:rPr><w:b><\/w:b><w:sz w:val="20"><\/w:sz><\/w:rPr><w:t[^>]*>Borrower<\/w:t><\/w:r>/,
        );
        // The "5" delete still carries the surrounding plain rPr (sz 20, no bold)
        expect(out).toContain('<w:delText xml:space="preserve">5</w:delText>');
        // The "7" insert is in a w:ins wrapper
        expect(out).toMatch(/<w:ins [^>]+>.*?<w:t xml:space="preserve">7<\/w:t>/);
    });

    it('preserves a bold word inside the equal region of a paragraph diff', () => {
        const file = loadDocx(buildMultiRunDocx());
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(
            0,
            [
                { kind: 'equal', text: 'The ' },
                { kind: 'equal', text: 'Borrower' },
                { kind: 'equal', text: ' shall pay 5' },
                { kind: 'delete', text: '%' },
                { kind: 'insert', text: ' percent' },
                { kind: 'equal', text: '.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Bold "Borrower" survives in the equal region with its <w:b/>
        const boldBorrowerCount = (
            out.match(
                /<w:rPr><w:b><\/w:b>[^<]*<w:sz w:val="20"><\/w:sz><\/w:rPr><w:t[^>]*>Borrower<\/w:t>/g,
            ) ?? []
        ).length;
        expect(boldBorrowerCount).toBe(1);
        // The delete carries the SURROUNDING (plain, sz 20) rPr — not bold
        expect(out).toMatch(
            /<w:del[^>]+><w:r><w:rPr><w:sz w:val="20"><\/w:sz><\/w:rPr><w:delText[^>]*>%<\/w:delText>/,
        );
    });

    it('falls back to first-run rPr when OOXML text doesn\'t match diff text', () => {
        // Build a paragraph where mammoth-style text would differ from OOXML
        // text (we simulate by passing diff ops whose equal+delete totals
        // don't match the OOXML run-text — e.g. ops include a "1. " list
        // marker that doesn't exist in <w:t>).
        const file = loadDocx(buildMultiRunDocx());
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(
            0,
            [
                // Diff thinks the paragraph starts with "1.  ", but OOXML doesn't
                { kind: 'equal', text: '1.  The Borrower shall pay ' },
                { kind: 'delete', text: '5' },
                { kind: 'insert', text: '7' },
                { kind: 'equal', text: '%.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Should fall back to first-run rPr (sz 20, NO bold). All generated
        // runs carry that.
        const sz20NoBoldCount = (
            out.match(
                /<w:r><w:rPr><w:sz w:val="20"><\/w:sz><\/w:rPr><w:t[^>]*>1\.  The Borrower/g,
            ) ?? []
        ).length;
        expect(sz20NoBoldCount).toBe(1);
        // Bold "Borrower" is gone — fallback flattens formatting
        expect(out).not.toMatch(/<w:b\/>/);
    });
});

describe('flatten/reconstruct edge cases', () => {
    function buildSingleParaDocx(paraInner: string): Buffer {
        const xmlnsW =
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p>${paraInner}</w:p>
  </w:body>
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

    it('preserves a bookmark sitting between runs in a modified paragraph', () => {
        const file = loadDocx(
            buildSingleParaDocx(`
              <w:r><w:t xml:space="preserve">The </w:t></w:r>
              <w:bookmarkStart w:id="0" w:name="termRef"/>
              <w:r><w:t>Borrower</w:t></w:r>
              <w:bookmarkEnd w:id="0"/>
              <w:r><w:t xml:space="preserve"> shall pay 5%.</w:t></w:r>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(
            0,
            [
                { kind: 'equal', text: 'The Borrower shall pay ' },
                { kind: 'delete', text: '5' },
                { kind: 'insert', text: '7' },
                { kind: 'equal', text: '%.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Both bookmark anchors survive (might have moved adjacency-wise
        // but they're still in the paragraph)
        expect(out).toContain('<w:bookmarkStart');
        expect(out).toContain('w:name="termRef"');
        expect(out).toContain('<w:bookmarkEnd');
        // Tracked change still applied
        expect(out).toContain('<w:ins');
        expect(out).toContain('<w:del');
    });

    it('counts text inside pre-existing <w:ins> as accepted-view content', () => {
        // Paragraph already has a tracked-insert from a prior edit cycle.
        // Diffing now sees that text as part of the paragraph; modifying
        // around it works without losing it.
        const file = loadDocx(
            buildSingleParaDocx(`
              <w:r><w:t xml:space="preserve">The </w:t></w:r>
              <w:ins w:id="50" w:author="Prior" w:date="2026-01-01T00:00:00Z">
                <w:r><w:t xml:space="preserve">new </w:t></w:r>
              </w:ins>
              <w:r><w:t>Borrower shall pay.</w:t></w:r>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        // accepted-view paraText = "The new Borrower shall pay."
        editor.applyParagraphDiff(
            0,
            [
                { kind: 'equal', text: 'The new ' },
                { kind: 'delete', text: 'Borrower' },
                { kind: 'insert', text: 'Lender' },
                { kind: 'equal', text: ' shall pay.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // The new tracked changes for Borrower → Lender are present
        expect(out).toContain('<w:delText xml:space="preserve">Borrower</w:delText>');
        expect(out).toContain('<w:t xml:space="preserve">Lender</w:t>');
        // Allocated revision ids are above the existing 50
        expect(out).toMatch(/<w:del w:id="(5[1-9]|[6-9]\d|\d{3,})"/);
    });

    it('leaves pre-existing <w:del> wrappers OUTSIDE the touched span untouched', () => {
        // Paragraph already has a tracked-delete (id=60) from a prior cycle.
        // Diffing sees accepted-view text (no "old "); the new edit on
        // "Borrower → Lender" runs entirely inside the second-run span and
        // doesn't touch the prior w:del wrapper. The prior tracked
        // change remains independent — the user can accept/reject it on
        // its own.
        const file = loadDocx(
            buildSingleParaDocx(`
              <w:r><w:t xml:space="preserve">The </w:t></w:r>
              <w:del w:id="60" w:author="Prior" w:date="2026-01-01T00:00:00Z">
                <w:r><w:delText xml:space="preserve">old </w:delText></w:r>
              </w:del>
              <w:r><w:t>Borrower shall pay.</w:t></w:r>
            `),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        // accepted-view paraText = "The Borrower shall pay." (no "old ")
        editor.applyParagraphDiff(
            0,
            [
                { kind: 'equal', text: 'The ' },
                { kind: 'delete', text: 'Borrower' },
                { kind: 'insert', text: 'Lender' },
                { kind: 'equal', text: ' shall pay.' },
            ],
            { inheritFormatting: true },
        );
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Prior w:del survives — independent revision
        expect(out).toContain('w:id="60"');
        expect(out).toContain('<w:delText xml:space="preserve">old </w:delText>');
        // New revision allocated above the existing 60
        expect(out).toMatch(/<w:del w:id="(6[1-9]|[7-9]\d|\d{3,})"[^>]*><w:r><w:delText[^>]*>Borrower<\/w:delText>/);
        expect(out).toContain('<w:t xml:space="preserve">Lender</w:t>');
    });
});

describe('TrackedChangesEditor.getBodyParagraphPPr', () => {
    it('returns a deep clone of the paragraph\'s pPr', () => {
        const xmlnsW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const richDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>
      <w:r><w:t>bullet item</w:t></w:r>
    </w:p>
  </w:body>
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
        zip.file('word/document.xml', richDoc);
        const file = loadDocx(zip.generate({ type: 'nodebuffer' }));
        const editor = new TrackedChangesEditor(file, AUTHOR);

        const pPr = editor.getBodyParagraphPPr(0);
        expect(pPr).not.toBeNull();
        const serialized = JSON.stringify(pPr);
        expect(serialized).toContain('ListBullet');
        expect(serialized).toContain('numId');

        // Pass to insertParagraph and confirm the inserted paragraph
        // carries the same style.
        editor.insertParagraph(0, 'inserted bullet', { pPr: pPr! });
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Two ListBullet/numPr-styled paragraphs now exist (original + inserted)
        const bulletMatches = out.match(/<w:pStyle w:val="ListBullet"/g) ?? [];
        expect(bulletMatches.length).toBe(2);
    });

    it('returns null for an out-of-range index', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'one' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        expect(editor.getBodyParagraphPPr(5)).toBeNull();
    });
});

describe('TrackedChangesEditor.deleteParagraph', () => {
    it('wraps content in w:del with delText and adds paragraph-mark del marker', () => {
        const file = loadDocx(
            buildMinimalDocx([
                { text: 'first paragraph' },
                { text: 'second paragraph' },
            ]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const id = editor.deleteParagraph(0);
        const out = bodyXml(loadDocx(saveDocx(file)));
        expect(out).toContain(`<w:del w:id="${id}"`);
        expect(out).toContain('<w:delText xml:space="preserve">first paragraph</w:delText>');
        // Paragraph-mark del marker lives inside w:pPr / w:rPr.
        // (Either self-closing `<w:del .../>` or paired `<w:del ...></w:del>`
        // are valid; fast-xml-parser emits the paired form for empty
        // elements.)
        expect(out).toMatch(/<w:pPr>.*<w:rPr>.*<w:del [^>]*>.*<\/w:rPr>.*<\/w:pPr>/s);
        // Second paragraph untouched
        expect(out).toContain('<w:t xml:space="preserve">second paragraph</w:t>');
    });
});

describe('TrackedChangesEditor.insertParagraph', () => {
    it('adds a new w:p after the given index with paragraph-mark + content ins markers', () => {
        const file = loadDocx(
            buildMinimalDocx([{ text: 'first' }, { text: 'second' }]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        const id = editor.insertParagraph(0, 'inserted middle');
        expect(editor.bodyParagraphCount()).toBe(3);
        const out = bodyXml(loadDocx(saveDocx(file)));
        expect(out).toContain(`<w:ins w:id="${id}"`);
        expect(out).toContain('<w:t xml:space="preserve">inserted middle</w:t>');
        // Paragraph-mark ins marker (inside pPr/rPr of the new paragraph).
        // Match either the self-closing or paired-empty form.
        expect(out).toMatch(
            /<w:rPr><w:ins [^>]*(?:\/>|><\/w:ins>)<\/w:rPr>/,
        );
    });

    it('afterIndex = -1 inserts at the start', () => {
        const file = loadDocx(
            buildMinimalDocx([{ text: 'first' }, { text: 'second' }]),
        );
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.insertParagraph(-1, 'new first');
        const out = bodyXml(loadDocx(saveDocx(file)));
        // Order: new first, then first, then second
        const a = out.indexOf('new first');
        const b = out.indexOf('>first<');
        const c = out.indexOf('>second<');
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
    });
});

describe('computeNextRevisionId', () => {
    it('returns 1 when there are no existing revisions', () => {
        const file = loadDocx(buildMinimalDocx());
        expect(computeNextRevisionId(file.document())).toBe(1);
    });

    it('returns max-existing-id + 1', () => {
        const xmlnsW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const docXml = `<?xml version="1.0"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p>
      <w:r><w:t>before </w:t></w:r>
      <w:ins w:id="42" w:author="Other" w:date="2026-04-01T00:00:00Z">
        <w:r><w:t>old insert</w:t></w:r>
      </w:ins>
      <w:r><w:t> after</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
        expect(computeNextRevisionId(parseXml(docXml))).toBe(43);
    });
});

describe('listRevisions', () => {
    it('finds both content wrappers and paragraph-mark markers', () => {
        const file = loadDocx(buildMinimalDocx([{ text: 'hello' }]));
        const editor = new TrackedChangesEditor(file, AUTHOR);
        editor.applyParagraphDiff(0, [
            { kind: 'delete', text: 'hello' },
            { kind: 'insert', text: 'goodbye' },
        ]);
        editor.deleteParagraph(0);
        editor.insertParagraph(0, 'new paragraph');

        const revs = listRevisions(file);
        // Should include content ins, content del, paragraph-mark del (from
        // deleteParagraph), and content ins + paragraph-mark ins (from
        // insertParagraph). Five revisions in total.
        const types = revs.map((r) => r.type).sort();
        expect(types).toEqual([
            'del',
            'del',
            'ins',
            'ins',
            'paragraph-mark-del',
            'paragraph-mark-ins',
        ].sort());
        for (const r of revs) {
            expect(r.author).toBe('Counsel');
            expect(r.date).toBe('2026-05-02T12:00:00Z');
            expect(r.id).toBeGreaterThan(0);
        }
    });
});
