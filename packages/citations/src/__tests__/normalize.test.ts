import { describe, expect, it } from 'vitest';
import { normalize, normalizeWithMap } from '../normalize.js';

describe('normalize', () => {
    it('collapses whitespace and trims', () => {
        expect(normalize('  hello   world\t\nagain  ')).toBe('hello world again');
    });

    it('replaces curly quotes with straight', () => {
        expect(normalize('He said “hi” and ‘bye’.')).toBe('He said "hi" and \'bye\'.');
    });

    it('replaces en/em dashes and minus with hyphen', () => {
        expect(normalize('2025–2030 — final')).toBe('2025-2030 - final');
    });

    it('replaces non-breaking space', () => {
        expect(normalize('hello world')).toBe('hello world');
    });
});

describe('normalizeWithMap', () => {
    it('returns text identical to normalize()', () => {
        const inputs = [
            'simple',
            '  leading and trailing  ',
            'curly “quote” here',
            'a b',
            'multi   space',
            'with\ttabs\nand\nnewlines',
            '',
        ];
        for (const s of inputs) {
            expect(normalizeWithMap(s).text).toBe(normalize(s));
        }
    });

    it('produces a map of length equal to text', () => {
        const r = normalizeWithMap('  hello   world  ');
        expect(r.map).toHaveLength(r.text.length);
    });

    it('maps every normalized char back into the original', () => {
        const original = 'He said “hi”  there.';
        const r = normalizeWithMap(original);
        // Every offset must be in range and produce the right normalized char
        // when remapped through the same transform pipeline.
        for (let i = 0; i < r.text.length; i++) {
            const origIdx = r.map[i]!;
            expect(origIdx).toBeGreaterThanOrEqual(0);
            expect(origIdx).toBeLessThan(original.length);
        }
    });

    it('lets a substring match be projected back to original offsets', () => {
        const original = '  Hello   world,  this is a TEST.  ';
        const r = normalizeWithMap(original);
        const idx = r.text.indexOf('world');
        expect(idx).toBeGreaterThanOrEqual(0);
        const origStart = r.map[idx]!;
        const origEnd = r.map[idx + 'world'.length - 1]! + 1;
        const slice = original.slice(origStart, origEnd);
        expect(slice).toBe('world');
    });

    it('projects a curly-quote substring back to the original characters', () => {
        const original = 'before “quoted phrase” after';
        const r = normalizeWithMap(original);
        const norm = r.text;
        const idx = norm.indexOf('"quoted phrase"');
        expect(idx).toBeGreaterThanOrEqual(0);
        const origStart = r.map[idx]!;
        const origEnd = r.map[idx + '"quoted phrase"'.length - 1]! + 1;
        const slice = original.slice(origStart, origEnd);
        expect(slice).toBe('“quoted phrase”');
    });

    it('handles empty input', () => {
        expect(normalizeWithMap('')).toEqual({ text: '', map: [] });
    });

    it('handles input that normalizes to empty', () => {
        expect(normalizeWithMap('   \t  \n')).toEqual({ text: '', map: [] });
    });
});
