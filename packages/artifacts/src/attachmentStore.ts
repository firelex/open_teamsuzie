import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { sanitizeIdSegment } from './safePath.js';

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AttachmentStoreOptions {
  /** Root directory for attachments. Each attachment lives in `<root>/<id>/`. */
  root: string;
  /** Allowed MIME types. Saving any other type throws. */
  allowedMime: ReadonlySet<string>;
  /**
   * Map MIME type to file extension used when the original filename has none.
   * Anything not in this map falls back to `bin`.
   */
  extensionByMime?: Record<string, string>;
  /** Max payload size in bytes. Defaults to 15 MiB. */
  maxBytes?: number;
}

/**
 * Stores attachments as `<root>/<uuid>/<filename>` with a sibling `meta.json`.
 * Enforces MIME allowlist + size limit and sanitises the original filename so
 * it's safe to put on disk. Generic over MIME policy so any department can
 * configure its own allowed types.
 */
export class AttachmentStore {
  private readonly root: string;
  private readonly allowed: ReadonlySet<string>;
  private readonly extMap: Record<string, string>;
  private readonly maxBytes: number;

  constructor(options: AttachmentStoreOptions) {
    this.root = options.root;
    this.allowed = options.allowedMime;
    this.extMap = options.extensionByMime ?? {};
    this.maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
  }

  private dirFor(id: string): string {
    return join(this.root, sanitizeIdSegment(id));
  }

  save(input: { originalName: string; mimeType: string; bytes: Buffer }): AttachmentMeta {
    const mimeType = input.mimeType.toLowerCase();
    if (!this.allowed.has(mimeType)) {
      throw new Error(`unsupported attachment type: ${mimeType}`);
    }
    if (input.bytes.length > this.maxBytes) {
      throw new Error('attachment exceeds size limit');
    }
    const id = randomUUID();
    const filename = this.sanitizeFilename(input.originalName, mimeType);
    const dir = this.dirFor(id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), input.bytes);
    const meta: AttachmentMeta = {
      id,
      filename,
      mimeType,
      sizeBytes: input.bytes.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  readMeta(id: string): AttachmentMeta | null {
    let safeId: string;
    try {
      safeId = sanitizeIdSegment(id);
    } catch {
      return null;
    }
    const metaPath = join(this.root, safeId, 'meta.json');
    if (!existsSync(metaPath)) return null;
    try {
      return JSON.parse(readFileSync(metaPath, 'utf8')) as AttachmentMeta;
    } catch {
      return null;
    }
  }

  readBytes(id: string): { meta: AttachmentMeta; bytes: Buffer } | null {
    const meta = this.readMeta(id);
    if (!meta) return null;
    const filePath = join(this.dirFor(meta.id), meta.filename);
    if (!existsSync(filePath)) return null;
    return { meta, bytes: readFileSync(filePath) };
  }

  /** Path of the stored payload file. Useful for copying into other roots. */
  filePath(id: string): string | null {
    const meta = this.readMeta(id);
    if (!meta) return null;
    return join(this.dirFor(meta.id), meta.filename);
  }

  delete(id: string): void {
    let safeId: string;
    try {
      safeId = sanitizeIdSegment(id);
    } catch {
      return;
    }
    const dir = join(this.root, safeId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  private sanitizeFilename(name: string, mimeType: string): string {
    const fallbackExt = this.extMap[mimeType] ?? 'bin';
    const base = name.split(/[\\/]/).pop() ?? '';
    const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!cleaned || cleaned === '.' || cleaned === '..') {
      return `attachment.${fallbackExt}`;
    }
    if (cleaned.includes('.')) return cleaned;
    return `${cleaned}.${fallbackExt}`;
  }
}
