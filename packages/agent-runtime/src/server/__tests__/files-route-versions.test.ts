import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '@teamsuzie/db-sqlite';
import {
  DocumentVersionsStore, DOCUMENT_VERSIONS_MIGRATIONS,
} from '@teamsuzie/document-versions';
import { createFilesRouter, InMemoryFileStore } from '../files-route.js';

describe('POST /api/files mints a document_versions row', () => {
  it('records source:upload referencing the file id', async () => {
    const db = openDb({ path: ':memory:', migrations: [...DOCUMENT_VERSIONS_MIGRATIONS] });
    const store = new InMemoryFileStore();
    const versionsStore = new DocumentVersionsStore({ db });

    const app = express();
    app.use('/api', createFilesRouter({ store, versionsStore }));

    const res = await request(app)
      .post('/api/files')
      .field('sessionId', 'sess-1')
      .attach('file', Buffer.from('hello'), 'note.txt');
    expect(res.status).toBe(201);

    const fileId = res.body.item.id as string;
    const head = versionsStore.getHead(fileId);
    expect(head).toBeDefined();
    expect(head!.source).toBe('upload');
    expect(head!.storageId).toBe(fileId);
    expect(head!.byteSize).toBe(5);
    expect(head!.parentId).toBeNull();
  });
});
