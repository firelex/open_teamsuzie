import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOfficeDocStore } from '../officeDocStore.js';
import { createFileRouter } from '../router.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'router-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function buildApp(opts: { authMiddleware?: (req: Request, res: Response, next: NextFunction) => void } = {}) {
  const app = express();
  const store = createOfficeDocStore({ root });
  app.use('/api/files', createFileRouter({ store, authMiddleware: opts.authMiddleware }));
  return app;
}

const PDF_MIME = 'application/pdf';

describe('createFileRouter', () => {
  it('round-trips upload → meta → download → delete', async () => {
    const app = buildApp();
    const client = supertest(app);

    const upload = await client
      .post('/api/files')
      .attach('file', Buffer.from('PDFDATA'), { filename: 'spec.pdf', contentType: PDF_MIME })
      .expect(200);
    expect(upload.body.id).toMatch(/[0-9a-f-]{36}/);
    expect(upload.body.filename).toBe('spec.pdf');
    expect(upload.body.mimeType).toBe(PDF_MIME);

    const meta = await client.get(`/api/files/${upload.body.id}/meta`).expect(200);
    expect(meta.body.id).toBe(upload.body.id);

    const dl = await client.get(`/api/files/${upload.body.id}`).expect(200);
    expect(dl.headers['content-type']).toContain(PDF_MIME);
    expect(dl.body.toString('utf8')).toBe('PDFDATA');

    await client.delete(`/api/files/${upload.body.id}`).expect(204);
    await client.get(`/api/files/${upload.body.id}/meta`).expect(404);
  });

  it('returns 415 for an unsupported mime type', async () => {
    const app = buildApp();
    await supertest(app)
      .post('/api/files')
      .attach('file', Buffer.from('PNG'), { filename: 'a.png', contentType: 'image/png' })
      .expect(415);
  });

  it('runs authMiddleware before route handlers', async () => {
    const calls: string[] = [];
    const app = buildApp({
      authMiddleware: (_req, _res, next) => {
        calls.push('auth');
        next();
      },
    });
    const res = await supertest(app)
      .post('/api/files')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF_MIME });
    expect(res.status).toBe(200);
    expect(calls).toEqual(['auth']);
  });

  it('rejects when authMiddleware short-circuits', async () => {
    const app = buildApp({
      authMiddleware: (_req, res, _next) => {
        res.status(401).json({ error: 'no actor' });
      },
    });
    await supertest(app)
      .post('/api/files')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF_MIME })
      .expect(401);
  });

  it('returns 404 for an unknown id', async () => {
    const app = buildApp();
    await supertest(app).get('/api/files/00000000-0000-0000-0000-000000000000').expect(404);
    await supertest(app).get('/api/files/00000000-0000-0000-0000-000000000000/meta').expect(404);
  });

  it('routes through resolveStore when provided', async () => {
    const app = express();
    const storeA = createOfficeDocStore({ root });
    let resolveCalls = 0;
    app.use(
      '/api/files',
      createFileRouter({
        resolveStore: () => {
          resolveCalls += 1;
          return storeA;
        },
      }),
    );
    await supertest(app)
      .post('/api/files')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF_MIME })
      .expect(200);
    expect(resolveCalls).toBe(1);
  });

  it('throws if neither store nor resolveStore is provided', () => {
    expect(() => createFileRouter({})).toThrow(/exactly one/);
  });

  it('throws if both store and resolveStore are provided', () => {
    const store = createOfficeDocStore({ root });
    expect(() => createFileRouter({ store, resolveStore: () => store })).toThrow(/exactly one/);
  });

  it('uses urlForMeta when provided', async () => {
    const app = express();
    const store = createOfficeDocStore({ root });
    app.use(
      '/api/files',
      createFileRouter({
        store,
        urlForMeta: (m) => `https://cdn.example.com/${m.id}/${m.filename}`,
      }),
    );
    const res = await supertest(app)
      .post('/api/files')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF_MIME })
      .expect(200);
    expect(res.body.url).toBe(`https://cdn.example.com/${res.body.id}/a.pdf`);
  });

  it('returns 413 when multer rejects an oversized upload', async () => {
    const app = express();
    const store = createOfficeDocStore({ root });
    app.use('/api/files', createFileRouter({ store, maxUploadBytes: 16 }));
    await supertest(app)
      .post('/api/files')
      .attach('file', Buffer.alloc(32), { filename: 'big.pdf', contentType: PDF_MIME })
      .expect(413);
  });

  it('urlForMeta also applies to GET /:id/meta', async () => {
    const app = express();
    const store = createOfficeDocStore({ root });
    app.use(
      '/api/files',
      createFileRouter({
        store,
        urlForMeta: (m) => `https://cdn.example.com/${m.id}`,
      }),
    );
    const client = supertest(app);
    const up = await client
      .post('/api/files')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF_MIME })
      .expect(200);
    const meta = await client.get(`/api/files/${up.body.id}/meta`).expect(200);
    expect(meta.body.url).toBe(`https://cdn.example.com/${up.body.id}`);
  });

  it('resolveStore is called for GET and DELETE, not only POST', async () => {
    const app = express();
    const store = createOfficeDocStore({ root });
    const seen: string[] = [];
    app.use(
      '/api/files',
      createFileRouter({
        resolveStore: (req) => {
          seen.push(req.method);
          return store;
        },
      }),
    );
    const client = supertest(app);
    const up = await client
      .post('/api/files')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: PDF_MIME })
      .expect(200);
    await client.get(`/api/files/${up.body.id}/meta`).expect(200);
    await client.get(`/api/files/${up.body.id}`).expect(200);
    await client.delete(`/api/files/${up.body.id}`).expect(204);
    expect(seen).toEqual(['POST', 'GET', 'GET', 'DELETE']);
  });
});
