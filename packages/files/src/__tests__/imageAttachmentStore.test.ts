import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_ATTACHMENT_MIME_TYPES, createImageAttachmentStore } from '../imageAttachmentStore.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'image-attachments-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createImageAttachmentStore', () => {
  it('accepts the four supported image types', () => {
    const store = createImageAttachmentStore({ root });
    for (const mimeType of IMAGE_ATTACHMENT_MIME_TYPES) {
      const meta = store.save({
        originalName: `photo`,
        mimeType,
        bytes: Buffer.from('IMG'),
      });
      expect(meta.mimeType).toBe(mimeType);
    }
  });

  it('rejects office doc MIME types', () => {
    const store = createImageAttachmentStore({ root });
    expect(() => store.save({
      originalName: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      bytes: Buffer.from('x'),
    })).toThrow(/unsupported/);
  });

  it('defaults to a 15 MiB cap', () => {
    const store = createImageAttachmentStore({ root });
    const huge = Buffer.alloc(15 * 1024 * 1024 + 1);
    expect(() => store.save({
      originalName: 'big.png',
      mimeType: 'image/png',
      bytes: huge,
    })).toThrow(/size limit/);
  });

  it('appends the right extension per mime when filename has none', () => {
    const store = createImageAttachmentStore({ root });
    const jpg = store.save({ originalName: 'capture', mimeType: 'image/jpeg', bytes: Buffer.from('x') });
    expect(jpg.filename.endsWith('.jpg')).toBe(true);
    const webp = store.save({ originalName: 'capture', mimeType: 'image/webp', bytes: Buffer.from('x') });
    expect(webp.filename.endsWith('.webp')).toBe(true);
  });
});
