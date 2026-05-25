import { describe, it, expect, vi } from 'vitest';
import { buildConvertToMarkdownTool } from '../convert-tool.js';
import type { ConvertFileStore } from '../tools.js';

function fakeStore(name: string, bytes: Buffer, mime: string): ConvertFileStore {
  return {
    get: () => ({ id: 'f1', name, mimeType: mime, bytes }),
    put: () => {},
  };
}

describe('buildConvertToMarkdownTool', () => {
  it('returns markdown + source metadata on success', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ filename: 'a.pdf', markdown: '# Hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const tool = buildConvertToMarkdownTool({
      fileStore: fakeStore('a.pdf', Buffer.from('binary'), 'application/pdf'),
      markitdownBaseUrl: 'http://md.test',
      fetchImpl,
    });

    const result = await tool.execute(
      { file_id: 'f1' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '', sessionId: 'sess1' },
    );

    expect(result).toMatchObject({
      markdown: '# Hello',
      source_filename: 'a.pdf',
      mime_type: 'application/pdf',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('errors when sessionId is missing from ctx', async () => {
    const tool = buildConvertToMarkdownTool({
      fileStore: fakeStore('a.pdf', Buffer.from('x'), 'application/pdf'),
      markitdownBaseUrl: 'http://md.test',
    });
    const result = await tool.execute(
      { file_id: 'f1' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '' },
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/sessionId/) });
  });

  it('errors when file_id not found', async () => {
    const store: ConvertFileStore = { get: () => undefined, put: () => {} };
    const tool = buildConvertToMarkdownTool({
      fileStore: store,
      markitdownBaseUrl: 'http://md.test',
    });
    const result = await tool.execute(
      { file_id: 'missing' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '', sessionId: 's' },
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/file_id/) });
  });
});
