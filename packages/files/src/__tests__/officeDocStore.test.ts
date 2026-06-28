import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OFFICE_DOC_MIME_TYPES, createOfficeDocStore } from '../officeDocStore.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'office-docs-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createOfficeDocStore', () => {
  it('accepts docx/pptx/xlsx/pdf', () => {
    const store = createOfficeDocStore({ root });
    for (const mimeType of OFFICE_DOC_MIME_TYPES) {
      const meta = store.save({
        originalName: `deck.${mimeType.endsWith('pdf') ? 'pdf' : 'bin'}`,
        mimeType,
        bytes: Buffer.from('payload'),
      });
      expect(meta.mimeType).toBe(mimeType);
    }
  });

  it('rejects image MIME types', () => {
    const store = createOfficeDocStore({ root });
    expect(() => store.save({
      originalName: 'photo.png',
      mimeType: 'image/png',
      bytes: Buffer.from('x'),
    })).toThrow(/unsupported/);
  });

  it('defaults to a 50 MiB cap', () => {
    const store = createOfficeDocStore({ root });
    const huge = Buffer.alloc(50 * 1024 * 1024 + 1);
    expect(() => store.save({
      originalName: 'big.pdf',
      mimeType: 'application/pdf',
      bytes: huge,
    })).toThrow(/size limit/);
  });

  it('honours a custom maxBytes', () => {
    const store = createOfficeDocStore({ root, maxBytes: 8 });
    expect(() => store.save({
      originalName: 'big.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.alloc(9),
    })).toThrow(/size limit/);
  });

  it('appends an extension when the filename lacks one', () => {
    const store = createOfficeDocStore({ root });
    const meta = store.save({
      originalName: 'pitch',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      bytes: Buffer.from('x'),
    });
    expect(meta.filename.endsWith('.pptx')).toBe(true);
  });
});
