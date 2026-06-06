import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MarkdownArtifactStore } from '../markdownStore.js';

interface DemoMeta {
    title: string;
    labels: string[];
    priority: number;
}

let dir: string;
let store: MarkdownArtifactStore<DemoMeta>;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'md-artifact-'));
    store = new MarkdownArtifactStore<DemoMeta>({
        dir,
        reservedFilenames: new Set(['tracker.md']),
        skipDirectoryNames: new Set(['.activity']),
        parseMeta: (data, { id }) => ({
            title: typeof data.title === 'string' ? data.title : id,
            labels: Array.isArray(data.labels) ? data.labels : [],
            priority: typeof data.priority === 'number' ? data.priority : 100,
        }),
        serializeMeta: (meta) => ({
            title: meta.title,
            labels: meta.labels,
            priority: meta.priority,
        }),
    });
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('MarkdownArtifactStore', () => {
    it('writes, reads, and lists', () => {
        store.write('a', { title: 'Alpha', labels: ['x'], priority: 1 }, 'Alpha body');
        store.write('b', { title: 'Beta', labels: [], priority: 2 }, 'Beta body');

        const all = store.list().map((x) => x.id).sort();
        expect(all).toEqual(['a', 'b']);

        const a = store.read('a');
        expect(a?.meta).toEqual({ title: 'Alpha', labels: ['x'], priority: 1 });
        expect(a?.body).toBe('Alpha body');
        expect(a?.updatedAt).toBeTruthy();
    });

    it('returns null for missing ids', () => {
        expect(store.read('nope')).toBeNull();
    });

    it('updates via read-modify-write', () => {
        store.write('a', { title: 'Alpha', labels: [], priority: 1 }, 'body');
        const next = store.update('a', (existing) => ({
            meta: { ...existing.meta, title: 'Renamed' },
            body: existing.body,
        }));
        expect(next?.meta.title).toBe('Renamed');
        expect(store.read('a')?.meta.title).toBe('Renamed');
    });

    it('update returns null for missing ids', () => {
        const out = store.update('missing', (existing) => ({ meta: existing.meta, body: existing.body }));
        expect(out).toBeNull();
    });

    it('deletes idempotently', () => {
        store.write('a', { title: 'A', labels: [], priority: 1 }, 'x');
        store.delete('a');
        store.delete('a');
        expect(store.exists('a')).toBe(false);
    });

    it('skips reserved filenames and non-md files', () => {
        store.write('real', { title: 'R', labels: [], priority: 1 }, 'r');
        writeFileSync(join(dir, 'tracker.md'), '# tracker');
        writeFileSync(join(dir, 'notes.txt'), 'ignored');
        expect(store.list().map((x) => x.id)).toEqual(['real']);
    });
});
