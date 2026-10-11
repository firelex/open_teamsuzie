import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { DocxFile, DocxInvalidError, DocxTooLargeError, loadDocx } from '../index.js';
import { buildMinimalDocx } from './fixtures.js';

// Zip packages built by hand, so a test can make one whose directory says things its data does not (CRCs left at 0:
// nothing checks them before the limit does).
function local(name: string, method: number, body: Buffer, size: number): Buffer {
    const n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(method, 8);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(n.length, 26);
    return Buffer.concat([h, n, body]);
}
function central(o: { name: string; method: number; compressed: number; size: number; local: number; extra?: Buffer; comment?: Buffer }): Buffer {
    const n = Buffer.from(o.name);
    const e = o.extra ?? Buffer.alloc(0);
    const c = o.comment ?? Buffer.alloc(0);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(o.method, 10);
    h.writeUInt32LE(o.compressed, 20); h.writeUInt32LE(o.size, 24); h.writeUInt16LE(n.length, 28); h.writeUInt16LE(e.length, 30); h.writeUInt16LE(c.length, 32);
    h.writeUInt32LE(o.local, 42);
    return Buffer.concat([h, n, e, c]);
}
function eocd(count: number, cdSize: number, cdStart: number): Buffer {
    const b = Buffer.alloc(22);
    b.writeUInt32LE(0x06054b50, 0); b.writeUInt16LE(count, 8); b.writeUInt16LE(count, 10);
    b.writeUInt32LE(cdSize, 12); b.writeUInt32LE(cdStart, 16);
    return b;
}
/** A package of the given parts, each as written (method 0 stored, 8 deflated), the directory honest. */
function pack(parts: Array<{ name: string; method: number; body: Buffer; size: number }>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const p of parts) {
        const l = local(p.name, p.method, p.body, p.size);
        centrals.push(central({ name: p.name, method: p.method, compressed: p.body.length, size: p.size, local: offset }));
        locals.push(l);
        offset += l.length;
    }
    const cd = Buffer.concat(centrals);
    return Buffer.concat([...locals, cd, eocd(parts.length, cd.length, offset)]);
}

const MB = 1024 * 1024;
const LIMIT = 10 * MB;
const doc = Buffer.from('<w:document/>');
const deflated = (bytes: number) => deflateRawSync(Buffer.alloc(bytes, 0x61));

describe('loading with a limit on what a package unpacks to', () => {
    it('loads an ordinary package exactly as without the limit', () => {
        const bytes = buildMinimalDocx();
        const limited = DocxFile.load(bytes, { maxUncompressedBytes: LIMIT });
        expect(limited.listParts().sort()).toEqual(loadDocx(bytes).listParts().sort());
        expect(limited.readPart('word/document.xml')!.equals(loadDocx(bytes).readPart('word/document.xml')!)).toBe(true);
    });

    it('refuses a plain zip bomb: a small deflated part that unpacks past the limit', () => {
        const bomb = pack([{ name: 'word/document.xml', method: 8, body: deflated(LIMIT + MB), size: LIMIT + MB }]);
        expect(bomb.length).toBeLessThan(MB);
        const err = (() => { try { loadDocx(bomb, { maxUncompressedBytes: LIMIT }); } catch (e) { return e; } return null; })();
        expect(err).toBeInstanceOf(DocxTooLargeError);
        expect((err as DocxTooLargeError).limit).toBe(LIMIT);
    });

    it('counts every part, measured by unpacking it, not by what the package declares', () => {
        const parts = [0, 1, 2].map((i) => ({ name: `word/p${i}.bin`, method: 8, body: deflated(4 * MB), size: 10 }));
        expect(() => loadDocx(pack([{ name: 'word/document.xml', method: 0, body: doc, size: doc.length }, ...parts]), { maxUncompressedBytes: LIMIT }))
            .toThrow(DocxTooLargeError);
    });

    it('counts a stored part by its length', () => {
        const stored = pack([{ name: 'word/document.xml', method: 0, body: doc, size: doc.length }, { name: 'word/big.bin', method: 0, body: Buffer.alloc(LIMIT + 1, 0x61), size: LIMIT + 1 }]);
        expect(() => loadDocx(stored, { maxUncompressedBytes: LIMIT })).toThrow(DocxTooLargeError);
        expect(loadDocx(stored, { maxUncompressedBytes: LIMIT + 1 + doc.length }).hasPart('word/big.bin')).toBe(true);
    });

    it('refuses an unknown compression method as an invalid package', () => {
        const bzip = pack([{ name: 'word/document.xml', method: 0, body: doc, size: doc.length }, { name: 'word/z.bin', method: 12, body: Buffer.from('BZh9'), size: 50 }]);
        expect(() => loadDocx(bzip, { maxUncompressedBytes: LIMIT })).toThrow(DocxInvalidError);
    });

    it('refuses what is not a zip at all as an invalid package', () => {
        expect(() => loadDocx(Buffer.from('not a zip'), { maxUncompressedBytes: LIMIT })).toThrow(DocxInvalidError);
    });

    it('measures the parts the zip reader itself found, so a directory entry hidden from a hand-written walk still counts', () => {
        // An extra field whose own length runs past the entry's extra block: the zip reader reads it by its own length,
        // swallowing the next entry's header, and then finds a hidden entry inside that entry's comment.
        const big = deflated(LIMIT + MB);
        const l0 = local('word/document.xml', 0, doc, doc.length);
        const l1 = local('word/media/huge.bin', 8, big, LIMIT + MB);
        const hidden = central({ name: 'word/media/huge.bin', method: 8, compressed: big.length, size: LIMIT + MB, local: l0.length });
        const decoy = central({ name: 'b', method: 0, compressed: 0, size: 0, local: 0, comment: hidden });
        const extra = Buffer.alloc(4); extra.writeUInt16LE(0xcafe, 0); extra.writeUInt16LE(46 + 1, 2);
        const a = central({ name: 'word/document.xml', method: 0, compressed: doc.length, size: doc.length, local: 0, extra });
        const cd = Buffer.concat([a, decoy]);
        const zip = Buffer.concat([l0, l1, cd, eocd(2, cd.length, l0.length + l1.length)]);
        expect(() => loadDocx(zip, { maxUncompressedBytes: LIMIT })).toThrow(DocxTooLargeError);
    });
});
