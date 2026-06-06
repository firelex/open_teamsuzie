import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScopedUploadStore } from '../uploadStore.js';

let root: string;
let store: ScopedUploadStore;

beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'upload-')), 'uploads');
    store = new ScopedUploadStore(root);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('ScopedUploadStore', () => {
    it('saves and lists files, including nested', () => {
        store.save('top.txt', Buffer.from('top'));
        store.save('nested/sub.txt', Buffer.from('hello'));

        const items = store.list();
        expect(items.map((i) => i.name).sort()).toEqual(['nested/sub.txt', 'top.txt']);
        expect(items.find((i) => i.name === 'top.txt')?.size).toBe(3);
    });

    it('reads bytes back', () => {
        store.save('a.txt', Buffer.from('hello'));
        const bytes = store.read('a.txt');
        expect(bytes?.toString('utf8')).toBe('hello');
    });

    it('rejects path traversal on save', () => {
        expect(() => store.save('../escape.txt', Buffer.from('x'))).toThrow();
    });

    it('returns empty list when root does not exist', () => {
        expect(store.list()).toEqual([]);
    });

    it('deletes and prunes empty parent dirs', () => {
        store.save('a/b/c.txt', Buffer.from('x'));
        store.delete('a/b/c.txt');
        expect(existsSync(join(root, 'a', 'b'))).toBe(false);
        expect(existsSync(join(root, 'a'))).toBe(false);
        // upload root itself stays
        expect(existsSync(root)).toBe(true);
    });

    it('delete is idempotent and safe for traversal', () => {
        store.delete('nope.txt');
        store.delete('../escape.txt');
        expect(store.list()).toEqual([]);
    });
});
