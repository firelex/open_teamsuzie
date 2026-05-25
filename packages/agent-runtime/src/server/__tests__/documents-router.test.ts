import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { InMemoryDocumentStore, MarkdownDocument } from '@teamsuzie/markdown-document';
import { InMemoryFileStore } from '../files-route.js';
import { createDocumentsRouter } from '../documents-router.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('POST /api/documents/:sessionId/:docId/export', () => {
  it('503s when markitdown is not configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore: new InMemoryFileStore(),
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: '',
    }));
    const res = await request(app).post('/api/documents/s/d/export').send({});
    expect(res.status).toBe(503);
  });

  it('404s when the doc is not in the session docStore', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore: new InMemoryFileStore(),
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: 'http://md.test',
    }));
    const res = await request(app).post('/api/documents/s/missing/export').send({});
    expect(res.status).toBe(404);
  });

  it('exports happy path: stashes DOCX in fileStore and returns downloadUrl', async () => {
    const fileStore = new InMemoryFileStore();
    const docStore = new InMemoryDocumentStore();
    const docId = docStore.put('s', new MarkdownDocument('# Hello', 'Offer Letter'));

    const docxBytes = Buffer.from('PK\x03\x04docx-bytes');
    const fetchImpl = vi.fn(async () =>
      new Response(docxBytes, { status: 200, headers: { 'content-type': DOCX_MIME } }),
    ) as unknown as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore, docStore, markitdownBaseUrl: 'http://md.test', fetchImpl,
    }));
    const res = await request(app)
      .post(`/api/documents/s/${docId}/export`)
      .send({ filename: 'offer' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      filename: 'offer.docx',
      downloadUrl: expect.stringMatching(/^\/api\/files\/s\/file_export_/),
    });
    const fileId = res.body.fileId as string;
    const rec = fileStore.get('s', fileId);
    expect(rec).toBeDefined();
    expect(rec!.mimeType).toBe(DOCX_MIME);
  });

  it('502s when markitdown-agent rejects the request', async () => {
    const docStore = new InMemoryDocumentStore();
    const docId = docStore.put('s', new MarkdownDocument('body', 'Doc'));
    const fetchImpl = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore: new InMemoryFileStore(),
      docStore,
      markitdownBaseUrl: 'http://md.test',
      fetchImpl,
    }));
    const res = await request(app)
      .post(`/api/documents/s/${docId}/export`)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/markitdown-agent/);
  });
});
