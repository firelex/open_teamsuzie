import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '@teamsuzie/db-sqlite';
import { createReferenceStore } from '../src/storage-sqlite.js';
import { REFERENCE_DESIGN_MIGRATIONS } from '../src/migrations.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('ReferenceStore.ingest — xlsx', () => {
  it('ingests an .xlsx buffer and persists a row with empty markdown', async () => {
    const db = openDb({ path: ':memory:', migrations: REFERENCE_DESIGN_MIGRATIONS });
    const uploadsDir = mkdtempSync(path.join(tmpdir(), 'refdesign-test-'));
    const store = createReferenceStore({
      db,
      uploadsDir,
      markitdownAgentBaseUrl: 'http://localhost:0',
    });
    const ref = await store.ingest(Buffer.from('PK\x03\x04stub-xlsx'), {
      mime: XLSX_MIME,
      originalName: 'blixt.xlsx',
      docType: 'lbo_template',
    });
    expect(ref.sourceMime).toBe(XLSX_MIME);
    expect(ref.contentMarkdown).toBe('');
    const fetched = store.get(ref.id);
    expect(fetched?.docType).toBe('lbo_template');
  });
});
