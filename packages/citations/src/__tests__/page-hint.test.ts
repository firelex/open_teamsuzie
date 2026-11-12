import { describe, expect, it } from 'vitest';
import { pageHintFromLocator } from '../index.js';

describe('pageHintFromLocator', () => {
    it('reads the page a locator names', () => {
        expect(pageHintFromLocator('p. 4')).toBe(4);
        expect(pageHintFromLocator('§2.1, page 12')).toBe(12);
    });
    it('gives undefined when the locator names no page', () => {
        expect(pageHintFromLocator('§2.4 Miscellaneous')).toBeUndefined();
        expect(pageHintFromLocator(undefined)).toBeUndefined();
        expect(pageHintFromLocator('p. 0')).toBeUndefined();
    });
});
