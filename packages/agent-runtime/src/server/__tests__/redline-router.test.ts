import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRedlineRouter } from '../redline-router.js';
import { InMemoryFileStore } from '../files-route.js';

function makeStore(): InMemoryFileStore {
  return new InMemoryFileStore();
}

describe('createRedlineRouter', () => {
  it('GET /:sessionId/:fileId/redline-view 404s for missing file', async () => {
    const app = express();
    app.use('/api/files', createRedlineRouter({
      fileStore: makeStore(),
      versionsStore: { addVersion: () => ({ id: 'v' }) },
    }));
    const res = await request(app).get('/api/files/s/missing/redline-view');
    expect(res.status).toBe(404);
  });

  it('GET /:sessionId/:fileId/redline-view 400s for non-docx', async () => {
    const store = makeStore();
    store.put({
      id: 'f1', sessionId: 's', name: 'note.txt', mimeType: 'text/plain',
      size: 1, bytes: Buffer.from('x'), createdAt: 0,
    });
    const app = express();
    app.use('/api/files', createRedlineRouter({
      fileStore: store,
      versionsStore: { addVersion: () => ({ id: 'v' }) },
    }));
    const res = await request(app).get('/api/files/s/f1/redline-view');
    expect(res.status).toBe(400);
  });

  it('POST /:sessionId/:fileId/revisions/resolve 404s for missing file', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/files', createRedlineRouter({
      fileStore: makeStore(),
      versionsStore: { addVersion: () => ({ id: 'v' }) },
    }));
    const res = await request(app)
      .post('/api/files/s/missing/revisions/resolve')
      .send({ accept: [1] });
    expect(res.status).toBe(404);
  });
});
