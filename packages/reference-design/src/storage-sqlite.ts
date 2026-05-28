import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { decomposeDocx } from './decompose-docx.js';
import { decomposePptx } from './decompose-pptx.js';
import { decomposeXlsx } from './decompose-xlsx.js';
import type { ReferenceDoc } from './types.js';
import type { DatabaseInstance } from '@teamsuzie/db-sqlite';
import type { ReferenceDocStore } from './storage.js';

export interface ReferenceStoreOptions {
  db: DatabaseInstance;
  uploadsDir: string;
  markitdownAgentBaseUrl: string;
  llmFn?: (prompt: string) => Promise<string>;
}

/**
 * SQLite-backed concrete impl of the `ReferenceDocStore` interface.
 * Stores the canonical bytes on disk; metadata + content markdown
 * in SQLite. Exposed as a class for backward compat with drafter, and a
 * `createReferenceStore` factory for new consumers.
 */
export class ReferenceStore implements ReferenceDocStore {
  constructor(private opts: ReferenceStoreOptions) {}

  async ingest(
    bytes: Buffer,
    file: { mime: string; originalName: string; docType: string },
  ): Promise<ReferenceDoc> {
    await mkdir(this.opts.uploadsDir, { recursive: true });
    const safeName = `${Date.now()}-${file.originalName.replace(/[^\w.-]/g, '_')}`;
    const sourcePath = path.join(this.opts.uploadsDir, safeName);
    await writeFile(sourcePath, bytes);

    const lower = file.originalName.toLowerCase();
    let ref: ReferenceDoc;
    if (file.mime.includes('wordprocessingml') || lower.endsWith('.docx')) {
      ref = await decomposeDocx(bytes, {
        docType: file.docType,
        displayName: file.originalName,
        sourceFilePath: sourcePath,
      });
    } else if (file.mime.includes('presentationml') || lower.endsWith('.pptx')) {
      ref = await decomposePptx(bytes, {
        docType: file.docType,
        displayName: file.originalName,
        sourceFilePath: sourcePath,
        markitdownAgentBaseUrl: this.opts.markitdownAgentBaseUrl,
        llmFn: this.opts.llmFn,
      });
    } else if (file.mime.includes('spreadsheetml') || lower.endsWith('.xlsx')) {
      ref = await decomposeXlsx(bytes, {
        docType: file.docType,
        displayName: file.originalName,
        sourceFilePath: sourcePath,
      });
    } else {
      throw new Error(`Unsupported reference doc type: ${file.mime}`);
    }

    this.persist(ref);
    return ref;
  }

  private persist(ref: ReferenceDoc): void {
    this.opts.db.prepare(`
      INSERT INTO reference_docs
        (id, doc_type, display_name, source_file_path, source_mime,
         content_markdown, design_usable, warnings_json, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ref.id, ref.docType, ref.displayName, ref.sourceFilePath, ref.sourceMime,
      ref.contentMarkdown, ref.designUsable ? 1 : 0, JSON.stringify(ref.warnings),
      Date.parse(ref.ingestedAt),
    );
  }

  list(docType?: string): ReferenceDoc[] {
    const rows = docType
      ? this.opts.db.prepare('SELECT * FROM reference_docs WHERE doc_type = ? ORDER BY ingested_at DESC').all(docType)
      : this.opts.db.prepare('SELECT * FROM reference_docs ORDER BY ingested_at DESC').all();
    return (rows as unknown[]).map(rowToRef);
  }

  get(id: string): ReferenceDoc | null {
    const row = this.opts.db.prepare('SELECT * FROM reference_docs WHERE id = ?').get(id);
    return row ? rowToRef(row) : null;
  }

  delete(id: string): Promise<void> {
    this.opts.db.prepare('DELETE FROM reference_docs WHERE id = ?').run(id);
    return Promise.resolve();
  }

  // ReferenceDocStore interface async adapters that delegate to the sync surface:
  async save(ref: ReferenceDoc): Promise<void> {
    this.persist(ref);
  }

  async load(id: string): Promise<ReferenceDoc | null> {
    return this.get(id);
  }

  async listByDocType(docType: string): Promise<ReferenceDoc[]> {
    return this.list(docType);
  }
}

function rowToRef(row: unknown): ReferenceDoc {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    docType: r.doc_type as string,
    displayName: r.display_name as string,
    sourceFilePath: r.source_file_path as string,
    sourceMime: r.source_mime as string,
    contentMarkdown: r.content_markdown as string,
    designUsable: Boolean(r.design_usable),
    warnings: JSON.parse(r.warnings_json as string),
    ingestedAt: new Date(Number(r.ingested_at)).toISOString(),
  };
}

export function createReferenceStore(opts: ReferenceStoreOptions): ReferenceStore {
  return new ReferenceStore(opts);
}
