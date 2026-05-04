import { describe, expect, it } from 'vitest';
import {
    PAGE_MARKER_REGEX,
    prepareDocumentForPrompt,
    prepareDocumentFromPages,
} from '../document.js';
import { MARKER_REGEX } from '../protocol.js';

describe('prepareDocumentForPrompt — basics', () => {
    it('marks a single-page document', () => {
        const { marked, handle } = prepareDocumentForPrompt('hello world', []);
        expect(marked).toBe('[page 1]\nhello world');
        expect(handle).toMatch(/^d-[0-9a-f]{16}$/);
    });

    it('marks a multi-page document with provided breaks', () => {
        const text = 'one page.\ntwo page.\nthree page.';
        const breaks = [text.indexOf('two'), text.indexOf('three')];
        const { marked } = prepareDocumentForPrompt(text, breaks);
        expect(marked).toBe(
            '[page 1]\none page.\n[page 2]\ntwo page.\n[page 3]\nthree page.',
        );
    });

    it('inserts a separating newline if a page does not end in one', () => {
        const text = 'no-newline-end';
        const breaks: number[] = [text.length / 2];
        const { marked } = prepareDocumentForPrompt(text, breaks);
        // Each page marker must be on its own line.
        const lines = marked.split('\n');
        expect(lines).toContain('[page 1]');
        expect(lines).toContain('[page 2]');
    });

    it('treats empty text as a single empty page', () => {
        const { marked } = prepareDocumentForPrompt('', []);
        expect(marked).toBe('[page 1]\n');
    });

    it('allows the last break to equal text.length (trailing empty page)', () => {
        const text = 'just one page';
        const { marked } = prepareDocumentForPrompt(text, [text.length]);
        expect(marked).toBe(`[page 1]\n${text}\n[page 2]\n`);
    });
});

describe('prepareDocumentForPrompt — validation', () => {
    it('throws on non-string text', () => {
        // @ts-expect-error
        expect(() => prepareDocumentForPrompt(42, [])).toThrow(TypeError);
    });

    it('throws on non-array pageBreaks', () => {
        // @ts-expect-error
        expect(() => prepareDocumentForPrompt('hi', 'nope')).toThrow(TypeError);
    });

    it('throws when a break is zero', () => {
        expect(() => prepareDocumentForPrompt('abc', [0])).toThrow(RangeError);
    });

    it('throws when a break is negative', () => {
        expect(() => prepareDocumentForPrompt('abc', [-1])).toThrow(RangeError);
    });

    it('throws when a break exceeds text length', () => {
        expect(() => prepareDocumentForPrompt('abc', [99])).toThrow(RangeError);
    });

    it('throws on duplicate breaks', () => {
        expect(() => prepareDocumentForPrompt('abcdef', [3, 3])).toThrow(RangeError);
    });

    it('throws on unsorted breaks', () => {
        expect(() => prepareDocumentForPrompt('abcdef', [4, 2])).toThrow(RangeError);
    });

    it('throws on non-integer breaks', () => {
        expect(() => prepareDocumentForPrompt('abcdef', [2.5])).toThrow(RangeError);
    });
});

describe('prepareDocumentForPrompt — handle behavior', () => {
    it('produces stable handles across re-prep of the same content', () => {
        const text = 'page one\npage two';
        const breaks = [text.indexOf('page two')];
        const a = prepareDocumentForPrompt(text, breaks);
        const b = prepareDocumentForPrompt(text, breaks);
        expect(a.handle).toBe(b.handle);
        expect(a.marked).toBe(b.marked);
    });

    it('produces different handles when content changes', () => {
        const a = prepareDocumentForPrompt('alpha', []);
        const b = prepareDocumentForPrompt('alpha ', []); // trailing space
        expect(a.handle).not.toBe(b.handle);
    });

    it('produces different handles when page break positions change', () => {
        const text = 'abcdef';
        const a = prepareDocumentForPrompt(text, [3]);
        const b = prepareDocumentForPrompt(text, [2]);
        expect(a.handle).not.toBe(b.handle);
    });

    it('respects a caller-supplied handle', () => {
        const { handle } = prepareDocumentForPrompt('abc', [], {
            handle: 'doc-7',
        });
        expect(handle).toBe('doc-7');
    });
});

describe('prepareDocumentForPrompt — round-trip stability', () => {
    it('round-trips a synthesized 50-page document deterministically', () => {
        const pages = Array.from(
            { length: 50 },
            (_, i) => `Page ${i + 1} content with marker ${i + 1}.\n`,
        );
        const text = pages.join('');
        const breaks: number[] = [];
        let cursor = 0;
        for (let i = 0; i < pages.length - 1; i++) {
            cursor += pages[i]!.length;
            breaks.push(cursor);
        }

        const a = prepareDocumentForPrompt(text, breaks);
        const b = prepareDocumentForPrompt(text, breaks);
        expect(a).toEqual(b);

        // Recover all 50 page markers in order.
        PAGE_MARKER_REGEX.lastIndex = 0;
        const found: number[] = [];
        const positions: number[] = [];
        for (
            let m = PAGE_MARKER_REGEX.exec(a.marked);
            m !== null;
            m = PAGE_MARKER_REGEX.exec(a.marked)
        ) {
            found.push(Number(m[1]));
            positions.push(m.index);
        }
        expect(found).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

        // Marker offsets are stable across re-prep.
        PAGE_MARKER_REGEX.lastIndex = 0;
        const positionsB: number[] = [];
        for (
            let m = PAGE_MARKER_REGEX.exec(b.marked);
            m !== null;
            m = PAGE_MARKER_REGEX.exec(b.marked)
        ) {
            positionsB.push(m.index);
        }
        expect(positionsB).toEqual(positions);
    });

    it('preserves each page content within its marker boundaries', () => {
        const pages = ['ALPHA\n', 'BETA WITH SPACES\n', 'GAMMA  '];
        const text = pages.join('');
        const breaks = [pages[0]!.length, pages[0]!.length + pages[1]!.length];
        const { marked } = prepareDocumentForPrompt(text, breaks);

        // Split on page markers and verify each non-empty segment equals the
        // corresponding original page (allowing for the renderer to absorb a
        // trailing newline into the marker boundary).
        const parts = marked.split(/\[page \d+\]\n/).slice(1);
        expect(parts).toHaveLength(3);
        for (let i = 0; i < pages.length; i++) {
            const expected = pages[i]!;
            const got = parts[i]!;
            // got is either pages[i] verbatim, or pages[i] minus a single
            // trailing \n that became the boundary before the next marker.
            expect([expected, expected.replace(/\n$/, '')]).toContain(got);
        }
    });
});

describe('prepareDocumentForPrompt — protocol compatibility', () => {
    it('page markers are not parsed as inline citation markers', () => {
        const { marked } = prepareDocumentForPrompt(
            'first.\nsecond.\nthird.',
            [7, 14],
        );
        MARKER_REGEX.lastIndex = 0;
        const matches = [...marked.matchAll(MARKER_REGEX)];
        // Citation marker regex requires only digits inside [], so [page N]
        // should not match.
        expect(matches).toHaveLength(0);
    });
});

describe('prepareDocumentFromPages', () => {
    it('produces the same output as prepareDocumentForPrompt with derived breaks', () => {
        const pages = ['one\n', 'two\n', 'three'];
        const fromPages = prepareDocumentFromPages(pages);
        const text = pages.join('');
        const breaks = [pages[0]!.length, pages[0]!.length + pages[1]!.length];
        const fromText = prepareDocumentForPrompt(text, breaks);
        expect(fromPages).toEqual(fromText);
    });

    it('handles a single-page array', () => {
        const { marked } = prepareDocumentFromPages(['only page']);
        expect(marked).toBe('[page 1]\nonly page');
    });

    it('handles an empty array as an empty single page', () => {
        const { marked } = prepareDocumentFromPages([]);
        expect(marked).toBe('[page 1]\n');
    });

    it('throws on non-array input', () => {
        // @ts-expect-error
        expect(() => prepareDocumentFromPages('nope')).toThrow(TypeError);
    });

    it('throws when a page is not a string', () => {
        // @ts-expect-error
        expect(() => prepareDocumentFromPages(['ok', 42, 'ok'])).toThrow(TypeError);
    });
});
