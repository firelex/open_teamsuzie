import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AttachmentStore } from '../attachmentStore.js';

let root: string;
let store: AttachmentStore;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'attachments-'));
    store = new AttachmentStore({
        root,
        allowedMime: new Set(['image/png', 'image/jpeg']),
        extensionByMime: { 'image/png': 'png', 'image/jpeg': 'jpg' },
        maxBytes: 1024,
    });
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('AttachmentStore', () => {
    it('saves and reads back', () => {
        const meta = store.save({
            originalName: 'screenshot.png',
            mimeType: 'image/png',
            bytes: Buffer.from('PNGDATA'),
        });
        expect(meta.filename).toBe('screenshot.png');
        const got = store.readBytes(meta.id);
        expect(got?.bytes.toString('utf8')).toBe('PNGDATA');
        expect(got?.meta.mimeType).toBe('image/png');
    });

    it('rejects unsupported mime types', () => {
        expect(() => store.save({
            originalName: 'a.gif',
            mimeType: 'image/gif',
            bytes: Buffer.from('x'),
        })).toThrow(/unsupported/);
    });

    it('rejects oversize payloads', () => {
        expect(() => store.save({
            originalName: 'big.png',
            mimeType: 'image/png',
            bytes: Buffer.alloc(2048),
        })).toThrow(/size limit/);
    });

    it('appends a mime-based extension when filename lacks one', () => {
        const meta = store.save({
            originalName: 'capture',
            mimeType: 'image/jpeg',
            bytes: Buffer.from('x'),
        });
        expect(meta.filename).toBe('capture.jpg');
    });

    it('falls back to a generic name when sanitization empties the name', () => {
        const meta = store.save({
            originalName: '../',
            mimeType: 'image/png',
            bytes: Buffer.from('x'),
        });
        expect(meta.filename).toBe('attachment.png');
    });

    it('returns null for unknown ids', () => {
        expect(store.readMeta('00000000-0000-0000-0000-000000000000')).toBeNull();
        expect(store.readBytes('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('rejects malformed ids without throwing on read', () => {
        expect(store.readMeta('../../etc')).toBeNull();
    });

    it('deletes the attachment directory', () => {
        const meta = store.save({
            originalName: 'a.png',
            mimeType: 'image/png',
            bytes: Buffer.from('x'),
        });
        store.delete(meta.id);
        expect(store.readMeta(meta.id)).toBeNull();
    });
});
