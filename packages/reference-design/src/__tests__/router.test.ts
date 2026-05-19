import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { openDb } from '@teamsuzie/db-sqlite';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createReferenceStore } from '../storage-sqlite.js';
import { REFERENCE_DESIGN_MIGRATIONS } from '../migrations.js';
import { createReferencesRouter } from '../router.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'ref-router-'));
  const db = openDb({ path: ':memory:', migrations: [...REFERENCE_DESIGN_MIGRATIONS] });
  const store = createReferenceStore({
    db,
    uploadsDir: tmp,
    markitdownAgentBaseUrl: 'http://localhost:3013',
  });
  const app = express();
  app.use(express.json());
  app.use('/api/references', createReferencesRouter(store));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('createReferencesRouter', () => {
  it('GET / returns empty array when no refs', async () => {
    const r = await fetch(`${baseUrl}/api/references`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it('POST / requires doc_type', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'application/octet-stream' }), 'x.docx');
    const r = await fetch(`${baseUrl}/api/references`, { method: 'POST', body: form });
    expect(r.status).toBe(400);
  });

  it('POST / rejects when file missing', async () => {
    const r = await fetch(`${baseUrl}/api/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_type: 'dd-report' }),
    });
    expect(r.status).toBe(400);
  });
});
