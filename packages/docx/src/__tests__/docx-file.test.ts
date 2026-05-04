import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { DocxFile, loadDocx, parseXml, saveDocx } from '../index.js';
import { buildMinimalDocx } from './fixtures.js';

function listZipParts(bytes: Buffer): Map<string, Buffer> {
    const zip = new PizZip(bytes);
    const out = new Map<string, Buffer>();
    for (const path of Object.keys(zip.files)) {
        const entry = zip.file(path);
        if (entry && !entry.dir) {
            out.set(path, Buffer.from(entry.asArrayBuffer()));
        }
    }
    return out;
}

describe('DocxFile.load', () => {
    it('reads every part in a minimal package', () => {
        const file = loadDocx(buildMinimalDocx());
        const parts = file.listParts().sort();
        expect(parts).toEqual(
            [
                '[Content_Types].xml',
                '_rels/.rels',
                'word/document.xml',
                'word/styles.xml',
            ].sort(),
        );
        expect(file.hasPart('word/document.xml')).toBe(true);
        expect(file.hasPart('word/missing.xml')).toBe(false);
    });

    it('rejects a zip that is missing word/document.xml', () => {
        const zip = new PizZip();
        zip.file('[Content_Types].xml', '<Types/>');
        const bytes = zip.generate({ type: 'nodebuffer' });
        expect(() => loadDocx(bytes)).toThrow(/word\/document\.xml/);
    });

    it('exposes raw part bytes via readPart', () => {
        const file = loadDocx(buildMinimalDocx());
        const docBytes = file.readPart('word/document.xml');
        expect(docBytes).toBeDefined();
        expect(docBytes!.toString('utf-8')).toContain('Hello world');
    });
});

describe('DocxFile.save (untouched)', () => {
    it('preserves every part byte-for-byte when nothing was modified', () => {
        const original = buildMinimalDocx();
        const out = saveDocx(loadDocx(original));

        const before = listZipParts(original);
        const after = listZipParts(out);

        expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
        for (const [path, bytes] of before) {
            expect(after.get(path)?.equals(bytes)).toBe(true);
        }
    });

    it('round-trip is idempotent (load → save → load → save → bytes equal)', () => {
        const original = buildMinimalDocx();
        const a = saveDocx(loadDocx(original));
        const b = saveDocx(loadDocx(a));
        expect(a.equals(b)).toBe(true);
    });
});

describe('DocxFile.document (parsed access)', () => {
    it('parses the document.xml tree on first access', () => {
        const file = loadDocx(buildMinimalDocx());
        const tree = file.document();
        expect(Array.isArray(tree)).toBe(true);
        // First node is the XML declaration; second is <w:document>
        const docNode = tree.find((n) => 'w:document' in n);
        expect(docNode).toBeDefined();
    });

    it('parsing alone does NOT modify the saved bytes', () => {
        const file = loadDocx(buildMinimalDocx());
        file.document(); // touch the lazy parser
        const out = saveDocx(file);
        const before = listZipParts(buildMinimalDocx());
        const after = listZipParts(out);
        for (const [path, bytes] of before) {
            expect(after.get(path)?.equals(bytes)).toBe(true);
        }
    });

    it('setDocument re-serializes on save (round-trips through the parser)', () => {
        const file = loadDocx(buildMinimalDocx());
        const tree = file.document();
        file.setDocument(tree);
        const out = saveDocx(file);
        const reloaded = loadDocx(out);
        const newDocBytes = reloaded.readPart('word/document.xml')!;
        // Re-parsing the re-serialized XML produces a structurally equal tree.
        const reparsed = parseXml(newDocBytes.toString('utf-8'));
        const original = parseXml(
            loadDocx(buildMinimalDocx())
                .readPart('word/document.xml')!
                .toString('utf-8'),
        );
        expect(reparsed).toEqual(original);
    });

    it('markDocumentDirty triggers re-serialization', () => {
        const file = loadDocx(buildMinimalDocx());
        // Touch document, then mark dirty without changing anything.
        file.document();
        file.markDocumentDirty();
        const out = saveDocx(file);
        const reloaded = loadDocx(out);
        const reparsed = parseXml(
            reloaded.readPart('word/document.xml')!.toString('utf-8'),
        );
        const original = parseXml(
            loadDocx(buildMinimalDocx())
                .readPart('word/document.xml')!
                .toString('utf-8'),
        );
        expect(reparsed).toEqual(original);
    });

    it('throws if markDocumentDirty is called before document()', () => {
        const file = loadDocx(buildMinimalDocx());
        expect(() => file.markDocumentDirty()).toThrow(/nothing to mark/);
    });
});

describe('DocxFile.setPart', () => {
    it('replaces a part on save', () => {
        const file = loadDocx(buildMinimalDocx());
        file.setPart('word/styles.xml', Buffer.from('<replaced/>', 'utf-8'));
        const out = saveDocx(file);
        const reloaded = loadDocx(out);
        expect(reloaded.readPart('word/styles.xml')?.toString('utf-8')).toBe(
            '<replaced/>',
        );
    });

    it('opaque parts (untouched) survive a save that modified other parts', () => {
        const file = loadDocx(buildMinimalDocx());
        file.setPart('word/styles.xml', Buffer.from('<replaced/>', 'utf-8'));
        const out = saveDocx(file);
        const reloaded = loadDocx(out);
        // _rels/.rels and [Content_Types].xml are byte-identical to source
        const original = listZipParts(buildMinimalDocx());
        for (const path of ['_rels/.rels', '[Content_Types].xml']) {
            expect(
                reloaded.readPart(path)!.equals(original.get(path)!),
            ).toBe(true);
        }
    });

    it('overwriting word/document.xml externally invalidates the parsed cache', () => {
        const file = loadDocx(buildMinimalDocx());
        const tree1 = file.document();
        const replacement = buildMinimalDocx([{ text: 'Different body' }]);
        const newDocBytes = loadDocx(replacement).readPart(
            'word/document.xml',
        )!;
        file.setPart('word/document.xml', newDocBytes);
        const tree2 = file.document();
        expect(tree2).not.toBe(tree1);
        // The new tree contains the new body text.
        const serialized = JSON.stringify(tree2);
        expect(serialized).toContain('Different body');
        expect(serialized).not.toContain('Hello world');
    });
});

describe('Element attributes round-trip', () => {
    it('preserves attributes (e.g. xml:space, w:val) through a parse/serialize cycle', () => {
        // Build a doc with a run carrying explicit run-properties + xml:space
        const xmlnsW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const richDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${xmlnsW}">
  <w:body>
    <w:p w:rsidR="00ABCDEF">
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
        <w:t xml:space="preserve">  Bold heading  </w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;
        const zip = new PizZip();
        zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
        zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        zip.file('word/document.xml', richDoc);
        const bytes = zip.generate({ type: 'nodebuffer' });

        const file = loadDocx(bytes);
        const tree = file.document();
        file.setDocument(tree); // force re-serialize on save
        const out = saveDocx(file);
        const reloaded = loadDocx(out);
        const reparsed = parseXml(
            reloaded.readPart('word/document.xml')!.toString('utf-8'),
        );

        // Walk both trees and confirm attributes survive.
        expect(reparsed).toEqual(parseXml(richDoc));
        const docNode = reparsed.find((n) => 'w:document' in n);
        const serialized = JSON.stringify(docNode);
        expect(serialized).toContain('00ABCDEF');
        expect(serialized).toContain('Heading1');
        expect(serialized).toContain('28');
        expect(serialized).toContain('  Bold heading  '); // leading/trailing ws preserved
    });
});

describe('Multiple paragraphs round-trip', () => {
    it('preserves a multi-paragraph body across load → save', () => {
        const original = buildMinimalDocx([
            { text: 'The Borrower shall pay interest at 5% per annum.' },
            { text: 'Either party may terminate upon thirty days written notice.' },
            { text: 'Governing law: State of Delaware.' },
        ]);
        const out = saveDocx(loadDocx(original));
        const reloaded = loadDocx(out);
        const docXml = reloaded.readPart('word/document.xml')!.toString('utf-8');
        expect(docXml).toContain('The Borrower shall pay interest at 5% per annum.');
        expect(docXml).toContain(
            'Either party may terminate upon thirty days written notice.',
        );
        expect(docXml).toContain('Governing law: State of Delaware.');
    });
});
