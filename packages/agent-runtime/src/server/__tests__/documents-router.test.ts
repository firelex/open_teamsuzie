import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateDocx } from '@teamsuzie/docx';
import { InMemoryDocumentStore, MarkdownDocument } from '@teamsuzie/markdown-document';
import { InMemoryFileStore } from '../files-route.js';
import {
  createDocumentsRouter, type StreamingRunChatTurn,
} from '../documents-router.js';

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

describe('POST /api/documents/compare/summary', () => {
  async function putDocx(
    store: InMemoryFileStore,
    id: string,
    name: string,
    paragraphs: string[],
  ): Promise<void> {
    const bytes = await generateDocx({
      title: name.replace(/\.docx$/, ''),
      sections: [{ paragraphs }],
    });
    store.put({
      id, sessionId: 's', name, mimeType: DOCX_MIME,
      size: bytes.length, bytes: Buffer.from(bytes), createdAt: 0,
    });
  }

  it('503s when no summary model is configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore: new InMemoryFileStore(),
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: '',
    }));
    const res = await request(app)
      .post('/api/documents/compare/summary')
      .send({ sessionId: 's', leftFileId: 'L', rightFileId: 'R' });
    expect(res.status).toBe(503);
  });

  it('400s when required body fields are missing', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore: new InMemoryFileStore(),
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: '',
      resolveSummaryModel: () => ({ baseUrl: 'http://x', model: 'm' }),
      runChatTurn: (async function* () { yield { type: 'done' as const }; }) as unknown as StreamingRunChatTurn,
    }));
    const res = await request(app)
      .post('/api/documents/compare/summary')
      .send({ sessionId: 's' });
    expect(res.status).toBe(400);
  });

  it('404s when left or right file is not in session', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore: new InMemoryFileStore(),
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: '',
      resolveSummaryModel: () => ({ baseUrl: 'http://x', model: 'm' }),
      runChatTurn: (async function* () { yield { type: 'done' as const }; }) as unknown as StreamingRunChatTurn,
    }));
    const res = await request(app)
      .post('/api/documents/compare/summary')
      .send({ sessionId: 's', leftFileId: 'ghost', rightFileId: 'phantom' });
    expect(res.status).toBe(404);
  });

  it('streams parsed topics one per SSE event and terminates with done', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'L', 'v1.docx', ['The Buyer keeps secrets.']);
    await putDocx(fileStore, 'R', 'v2.docx', ['The Purchaser keeps secrets.']);

    // Fake LLM stream: emits two complete NDJSON lines in three chunks
    // (mid-line break across chunks) to prove the buffer logic flushes
    // only on complete lines.
    const fakeRunChatTurn = (async function* () {
      yield { type: 'chunk' as const, text: '{"topic":"Party","left":"Buyer","right":"Purchaser"}\n' };
      yield { type: 'chunk' as const, text: '{"topic":"Confidentiality","left":"Secret kept",' };
      yield { type: 'chunk' as const, text: '"right":"Same"}\n' };
      yield { type: 'done' as const };
    }) as unknown as StreamingRunChatTurn;

    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore,
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: '',
      resolveSummaryModel: () => ({ baseUrl: 'http://x', model: 'm' }),
      runChatTurn: fakeRunChatTurn,
    }));

    const res = await request(app)
      .post('/api/documents/compare/summary')
      .send({ sessionId: 's', leftFileId: 'L', rightFileId: 'R' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('"topic":"Party"');
    expect(res.text).toContain('"topic":"Confidentiality"');
    expect(res.text).toContain('"done":true');
  });

  it('skips malformed lines silently and still terminates', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'L', 'a.docx', ['v1']);
    await putDocx(fileStore, 'R', 'b.docx', ['v2']);

    const fakeRunChatTurn = (async function* () {
      yield { type: 'chunk' as const, text: 'this is not json\n' };
      yield { type: 'chunk' as const, text: '{"topic":"Good","left":"X","right":"Y"}\n' };
      yield { type: 'chunk' as const, text: '{\nbroken\n' };
      yield { type: 'done' as const };
    }) as unknown as StreamingRunChatTurn;

    const app = express();
    app.use(express.json());
    app.use('/api/documents', createDocumentsRouter({
      fileStore,
      docStore: new InMemoryDocumentStore(),
      markitdownBaseUrl: '',
      resolveSummaryModel: () => ({ baseUrl: 'http://x', model: 'm' }),
      runChatTurn: fakeRunChatTurn,
    }));

    const res = await request(app)
      .post('/api/documents/compare/summary')
      .send({ sessionId: 's', leftFileId: 'L', rightFileId: 'R' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"topic":"Good"');
    expect(res.text).toContain('"done":true');
  });
});
