import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertToMarkdown } from '../convert.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// PDFs convert natively now; XLSX still goes through markitdown-agent.
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('convertToMarkdown', () => {
  const baseUrl = 'http://localhost:3013';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes DOCX through mammoth (no service call)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const bytes = await readFixture('empty.docx');
    const result = await convertToMarkdown(bytes, { mime: DOCX, filename: 'x.docx', markitdownAgentBaseUrl: baseUrl });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(typeof result.markdown).toBe('string');
  });

  it('routes XLSX through markitdown-agent /convert', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ filename: 'x.xlsx', markdown: '# Hello' }), { status: 200 })
    );
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await convertToMarkdown(bytes, { mime: XLSX, filename: 'x.xlsx', markitdownAgentBaseUrl: baseUrl });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://localhost:3013/convert');
    expect(result.markdown).toBe('# Hello');
  });

  it('handles markitdown-agent errors with a clear thrown error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      convertToMarkdown(new Uint8Array([1]), { mime: XLSX, filename: 'x.xlsx', markitdownAgentBaseUrl: baseUrl })
    ).rejects.toThrow(/markitdown-agent.*500/);
  });

  it('falls back to markitdown for unknown MIME types', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ filename: 'x.bin', markdown: '(empty)' }), { status: 200 })
    );
    await convertToMarkdown(new Uint8Array([0]), { mime: 'application/octet-stream', filename: 'x.bin', markitdownAgentBaseUrl: baseUrl });
    expect(fetchSpy).toHaveBeenCalled();
  });
});

async function readFixture(name: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  return new Uint8Array(await readFile(path.join(here, 'fixtures', name)));
}

import { readFileSync as _pptxRead } from 'node:fs';
import { join as _pptxJoin } from 'node:path';
import { fileURLToPath as _pptxFileURLToPath } from 'node:url';

const __pptxFixturesDir = _pptxFileURLToPath(new URL('.', import.meta.url));
const __pptxFixture = _pptxRead(_pptxJoin(__pptxFixturesDir, 'fixtures/sample.pptx'));

describe('convertToMarkdown – pptx', () => {
  it('uses the native pptx path (no markitdown call)', async () => {
    let fetchCalled = false;
    const result = await convertToMarkdown(__pptxFixture, {
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: 'deck.pptx',
      markitdownAgentBaseUrl: 'http://should-not-be-called',
      fetchImpl: (async () => {
        fetchCalled = true;
        throw new Error('markitdown should not be called for pptx');
      }) as typeof fetch,
    });
    expect(result.backend).toBe('pptx-native');
    expect(fetchCalled).toBe(false);
    expect(result.markdown).toMatch(/## Slide 1\b/);
  });

  it('surfaces pptx parse errors directly (no markitdown fallback)', async () => {
    await expect(convertToMarkdown(Buffer.from('not a zip'), {
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: 'broken.pptx',
      markitdownAgentBaseUrl: 'http://should-not-be-called',
      fetchImpl: (async () => { throw new Error('must not call'); }) as typeof fetch,
    })).rejects.toThrow();
  });
});

describe('plain text', () => {
  it('decodes .txt and .md without the markitdown agent, and refuses bytes that are not UTF-8', async () => {
    const { convertToMarkdown } = await import('../convert.js');
    const fetchImpl = (() => {
      throw new Error('markitdown must not be called');
    }) as unknown as typeof fetch;
    const txt = await convertToMarkdown(Buffer.from('﻿Order: Defence by 2 December 2026'), {
      mime: 'text/plain',
      filename: 'order.txt',
      markitdownAgentBaseUrl: '',
      fetchImpl,
    });
    expect(txt).toEqual({ markdown: 'Order: Defence by 2 December 2026', backend: 'text-native' });
    expect((await convertToMarkdown(Buffer.from('# Notes'), { mime: '', filename: 'n.md', markitdownAgentBaseUrl: '' })).markdown).toBe('# Notes');
    await expect(
      convertToMarkdown(Buffer.from([0xff, 0xfe, 0x41]), { mime: 'text/plain', filename: 'bad.txt', markitdownAgentBaseUrl: '' }),
    ).rejects.toThrow(/not valid UTF-8/);
  });
});
