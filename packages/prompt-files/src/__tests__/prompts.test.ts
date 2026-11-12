import { describe, expect, it } from 'vitest';
import { fill, promptLoader } from '../index.js';

const prompt = promptLoader(new URL('./fixtures/', import.meta.url));

describe('prompt files', () => {
    it('includes, fills and keeps doubled braces literal', () => {
        expect(fill(prompt('main'), { name: 'Jane' })).toBe('Hello Jane.\nIncluded for Jane.Braces: {"a": 1}');
    });
    it('refuses missing files, files without a final line break and missing values', () => {
        expect(() => prompt('nowhere')).toThrow(/there is no prompt nowhere/);
        expect(() => prompt('bad')).toThrow(/does not end with a line break/);
        expect(() => fill('{a} {b}', { a: '1' })).toThrow(/needs a value for \{b\}/);
        expect(() => promptLoader(new URL('file:///x'))).toThrow(/end with a slash/);
    });
});
