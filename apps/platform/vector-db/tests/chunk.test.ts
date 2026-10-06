import { describe, it, expect } from 'vitest';

import { chunkContent } from '../src/services/chunk.js';

describe('chunkContent', () => {
    it('returns one chunk for text shorter than a chunk', () => {
        expect(chunkContent('hello world', 1000, 200)).toEqual(['hello world']);
    });

    it('slides a window with the given overlap and stops at the end', () => {
        const words = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
        const chunks = chunkContent(words, 10, 3);
        expect(chunks.map((chunk) => chunk.split(' ')[0])).toEqual(['w0', 'w7', 'w14', 'w21']);
        expect(chunks.at(-1)?.split(' ').at(-1)).toBe('w24');
    });

    it('ends when a window reaches the last word exactly', () => {
        const words = Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ');
        expect(chunkContent(words, 10, 3)).toEqual([words]);
    });

    it('rejects an overlap that would stop the window moving forward', () => {
        expect(() => chunkContent('a b c', 10, 10)).toThrow(/overlap/);
        expect(() => chunkContent('a b c', 10, -1)).toThrow(/overlap/);
    });
});
