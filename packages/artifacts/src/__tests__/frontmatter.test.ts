import { describe, expect, it } from 'vitest';

import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';

describe('frontmatter', () => {
    it('roundtrips scalar values', () => {
        const src = '---\ntitle: Hello\ncount: 3\nready: true\n---\nbody text\n';
        const { data, body } = parseFrontmatter(src);
        expect(data).toEqual({ title: 'Hello', count: 3, ready: true });
        expect(body).toBe('body text\n');

        const reserialized = serializeFrontmatter(data, body);
        expect(parseFrontmatter(reserialized).data).toEqual(data);
        expect(parseFrontmatter(reserialized).body).toBe(body);
    });

    it('roundtrips list values', () => {
        const src = '---\nlabels: [bug, ui, p1]\n---\nhi\n';
        const { data } = parseFrontmatter(src);
        expect(data.labels).toEqual(['bug', 'ui', 'p1']);
        const out = serializeFrontmatter(data, 'hi\n');
        expect(out).toContain('labels: [bug, ui, p1]');
    });

    it('returns empty data and full body when no frontmatter', () => {
        const { data, body } = parseFrontmatter('just text');
        expect(data).toEqual({});
        expect(body).toBe('just text');
    });

    it('strips quotes around quoted strings', () => {
        const { data } = parseFrontmatter('---\ntitle: "Quoted Title"\n---\n');
        expect(data.title).toBe('Quoted Title');
    });

    it('ignores comment and blank frontmatter lines', () => {
        const src = '---\n# comment\n\ntitle: A\n---\nbody';
        const { data } = parseFrontmatter(src);
        expect(data).toEqual({ title: 'A' });
    });
});
