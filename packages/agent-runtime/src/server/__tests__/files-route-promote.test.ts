import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFilesRouter, InMemoryFileStore } from '../files-route.js';

describe('POST /api/files/promote', () => {
  it('re-keys files from one session to another', async () => {
    const store = new InMemoryFileStore();
    store.put({
      id: 'f1', sessionId: 'tab-1', name: 'nda.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 5, bytes: Buffer.from('hello'), createdAt: 0,
    });

    const app = express();
    app.use(express.json());
    app.use('/api', createFilesRouter({ store }));

    const res = await request(app)
      .post('/api/files/promote')
      .send({ fromSessionId: 'tab-1', toSessionId: 'chat-7', fileIds: ['f1'] });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('f1');

    // File is reachable under the new session, gone from the old.
    expect(store.get('chat-7', 'f1')).toBeDefined();
    expect(store.get('tab-1', 'f1')).toBeUndefined();
  });

  it('400s when fromSessionId or toSessionId is missing', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createFilesRouter({ store: new InMemoryFileStore() }));

    const r1 = await request(app)
      .post('/api/files/promote')
      .send({ toSessionId: 'c', fileIds: ['f'] });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post('/api/files/promote')
      .send({ fromSessionId: 't', fileIds: ['f'] });
    expect(r2.status).toBe(400);
  });

  it('400s when fileIds is empty', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createFilesRouter({ store: new InMemoryFileStore() }));
    const res = await request(app)
      .post('/api/files/promote')
      .send({ fromSessionId: 't', toSessionId: 'c', fileIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns empty items when source session has no matching files', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createFilesRouter({ store: new InMemoryFileStore() }));
    const res = await request(app)
      .post('/api/files/promote')
      .send({ fromSessionId: 'nope', toSessionId: 'c', fileIds: ['ghost'] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
