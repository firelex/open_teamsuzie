import { describe, expect, it } from 'vitest';

import { isSafeFilename, sanitizeIdSegment, sanitizeSubpath } from '../safePath.js';

describe('sanitizeSubpath', () => {
    it('accepts nested relative paths', () => {
        expect(sanitizeSubpath('a/b/c.png')).toBe('a/b/c.png');
    });

    it('strips leading slashes', () => {
        expect(sanitizeSubpath('/a/b.png')).toBe('a/b.png');
    });

    it('normalises backslashes to forward slashes', () => {
        expect(sanitizeSubpath('a\\b\\c.png')).toBe('a/b/c.png');
    });

    it('rejects empty paths', () => {
        expect(() => sanitizeSubpath('')).toThrow(/empty/);
        expect(() => sanitizeSubpath('/')).toThrow(/empty/);
    });

    it('rejects parent traversal', () => {
        expect(() => sanitizeSubpath('..')).toThrow(/escapes/);
        expect(() => sanitizeSubpath('../etc/passwd')).toThrow(/escapes/);
        expect(() => sanitizeSubpath('a/../../b')).toThrow(/escapes/);
    });
});

describe('sanitizeIdSegment', () => {
    it('accepts safe segments', () => {
        expect(sanitizeIdSegment('abc-123_xyz')).toBe('abc-123_xyz');
    });

    it('rejects slashes and dots', () => {
        expect(() => sanitizeIdSegment('a/b')).toThrow();
        expect(() => sanitizeIdSegment('..')).toThrow();
        expect(() => sanitizeIdSegment('a.b')).toThrow();
    });
});

describe('isSafeFilename', () => {
    it('flags traversal and slashes', () => {
        expect(isSafeFilename('a.png')).toBe(true);
        expect(isSafeFilename('a/b.png')).toBe(false);
        expect(isSafeFilename('..')).toBe(false);
        expect(isSafeFilename('')).toBe(false);
    });
});
