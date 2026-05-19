import { describe, it, expect } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createReferenceStore } from '../storage-sqlite.js';
import { REFERENCE_DESIGN_MIGRATIONS } from '../migrations.js';

describe('createReferenceStore', () => {
  it('persists, lists, gets, and deletes a row', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ref-store-'));
    const db = openDb({ path: ':memory:', migrations: [...REFERENCE_DESIGN_MIGRATIONS] });
    const store = createReferenceStore({
      db,
      uploadsDir: tmp,
      markitdownAgentBaseUrl: 'http://localhost:3013',
    });

    const now = Date.now();
    db.prepare(`
      INSERT INTO reference_docs
        (id, doc_type, display_name, source_file_path, source_mime,
         content_markdown, design_usable, warnings_json, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ref-1', 'dd-report', 'DD_Memo.docx', '/tmp/m.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '# DD Memo\n\nBody.', 1, '[]', now,
    );

    expect(store.list('dd-report')).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
    const got = store.get('ref-1');
    expect(got).not.toBeNull();
    expect(got!.displayName).toBe('DD_Memo.docx');
    expect(got!.designUsable).toBe(true);
    expect(got!.contentMarkdown).toContain('DD Memo');

    store.delete('ref-1');
    expect(store.list()).toHaveLength(0);
  });

  it('rejects unsupported MIME types in ingest()', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ref-store-'));
    const db = openDb({ path: ':memory:', migrations: [...REFERENCE_DESIGN_MIGRATIONS] });
    const store = createReferenceStore({
      db,
      uploadsDir: tmp,
      markitdownAgentBaseUrl: 'http://localhost:3013',
    });

    await expect(
      store.ingest(Buffer.from('not-a-real-doc'), {
        mime: 'application/pdf',
        originalName: 'foo.pdf',
        docType: 'dd-report',
      }),
    ).rejects.toThrow(/Unsupported reference doc type/);
  });
});
