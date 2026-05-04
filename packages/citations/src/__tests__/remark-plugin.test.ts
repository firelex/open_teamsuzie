import { describe, expect, it } from 'vitest';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Root } from 'mdast';

import { CITE_URL_SCHEME, parseCiteUrl, remarkCitations } from '../remark-plugin.js';

function parse(md: string): Root {
    const tree = unified().use(remarkParse).parse(md);
    remarkCitations()(tree);
    return tree as Root;
}

type Captured = {
    type: string;
    url?: string;
    value?: string;
    children?: Captured[];
};

function summarize(node: unknown): Captured {
    const n = node as Record<string, unknown>;
    const out: Captured = { type: String(n.type) };
    if (typeof n.url === 'string') out.url = n.url;
    if (typeof n.value === 'string') out.value = n.value;
    if (Array.isArray(n.children)) {
        out.children = n.children.map((c: unknown) => summarize(c));
    }
    return out;
}

function findFirstParagraph(root: Root): Captured {
    const para = root.children.find((c) => c.type === 'paragraph');
    if (!para) throw new Error('no paragraph found');
    return summarize(para);
}

describe('remarkCitations', () => {
    it('replaces a single marker with a cite: link', () => {
        const root = parse('Delaware governs [1] the contract.');
        const para = findFirstParagraph(root);
        expect(para.children?.map((c) => c.type)).toEqual(['text', 'link', 'text']);
        const link = para.children?.[1]!;
        expect(link.url).toBe(`${CITE_URL_SCHEME}1`);
        expect(link.children?.[0]?.value).toBe('[1]');
    });

    it('replaces multiple markers in one paragraph', () => {
        const root = parse('First [1] then [2] then [3].');
        const para = findFirstParagraph(root);
        const links = (para.children ?? []).filter((c) => c.type === 'link');
        expect(links.map((l) => l.url)).toEqual([
            `${CITE_URL_SCHEME}1`,
            `${CITE_URL_SCHEME}2`,
            `${CITE_URL_SCHEME}3`,
        ]);
    });

    it('handles markers at start and end of text', () => {
        const root = parse('[1] opens and ends with [2]');
        const para = findFirstParagraph(root);
        const types = (para.children ?? []).map((c) => c.type);
        expect(types[0]).toBe('link');
        expect(types[types.length - 1]).toBe('link');
    });

    it('preserves out-of-order markers', () => {
        const root = parse('Skipping ahead to [3], then back to [1].');
        const para = findFirstParagraph(root);
        const links = (para.children ?? []).filter((c) => c.type === 'link');
        expect(links.map((l) => l.url)).toEqual([
            `${CITE_URL_SCHEME}3`,
            `${CITE_URL_SCHEME}1`,
        ]);
    });

    it('skips markers inside fenced code blocks', () => {
        const md = ['Before [1].', '', '```js', 'arr[2] = arr[3];', '```', '', 'After [4].'].join('\n');
        const root = parse(md);
        const codeNode = root.children.find((c) => c.type === 'code');
        expect(codeNode).toBeDefined();
        expect((codeNode as { value: string }).value).toContain('arr[2] = arr[3];');

        const links = root.children
            .filter((c) => c.type === 'paragraph')
            .flatMap((p) => (summarize(p).children ?? []).filter((c) => c.type === 'link'));
        expect(links.map((l) => l.url)).toEqual([
            `${CITE_URL_SCHEME}1`,
            `${CITE_URL_SCHEME}4`,
        ]);
    });

    it('skips markers inside inline code spans', () => {
        const root = parse('See `array[5]` for context, but cite [1].');
        const para = findFirstParagraph(root);
        const types = (para.children ?? []).map((c) => c.type);
        expect(types).toContain('inlineCode');
        const links = (para.children ?? []).filter((c) => c.type === 'link');
        expect(links).toHaveLength(1);
        expect(links[0]?.url).toBe(`${CITE_URL_SCHEME}1`);
    });

    it('leaves non-numeric brackets alone', () => {
        const root = parse('[abc] and [1.5] and [].');
        const para = findFirstParagraph(root);
        const links = (para.children ?? []).filter((c) => c.type === 'link');
        expect(links).toHaveLength(0);
    });

    it('does not transform real markdown links into cite chips', () => {
        const root = parse('See [1](https://example.com) for context.');
        const para = findFirstParagraph(root);
        const links = (para.children ?? []).filter((c) => c.type === 'link');
        expect(links).toHaveLength(1);
        expect(links[0]?.url).toBe('https://example.com');
    });

    it('handles a marker adjacent to punctuation', () => {
        const root = parse('Claim,[1] then more.');
        const para = findFirstParagraph(root);
        const link = (para.children ?? []).find((c) => c.type === 'link');
        expect(link?.url).toBe(`${CITE_URL_SCHEME}1`);
    });
});

describe('parseCiteUrl', () => {
    it('extracts a positive integer id from a cite: URL', () => {
        expect(parseCiteUrl('cite:1')).toBe(1);
        expect(parseCiteUrl('cite:42')).toBe(42);
    });

    it('returns null for non-cite URLs', () => {
        expect(parseCiteUrl('https://example.com')).toBeNull();
        expect(parseCiteUrl('#anchor')).toBeNull();
        expect(parseCiteUrl('mailto:a@b.c')).toBeNull();
    });

    it('returns null for malformed cite URLs', () => {
        expect(parseCiteUrl('cite:')).toBeNull();
        expect(parseCiteUrl('cite:abc')).toBeNull();
        expect(parseCiteUrl('cite:0')).toBeNull();
        expect(parseCiteUrl('cite:-1')).toBeNull();
        expect(parseCiteUrl('cite:1.5')).toBeNull();
    });

    it('returns null for null/undefined/non-string', () => {
        expect(parseCiteUrl(null)).toBeNull();
        expect(parseCiteUrl(undefined)).toBeNull();
        // @ts-expect-error
        expect(parseCiteUrl(123)).toBeNull();
    });
});
