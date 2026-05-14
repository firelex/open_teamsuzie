import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertToMarkdown } from '../convert.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';

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

  it('routes PDF through markitdown-agent /convert', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ filename: 'x.pdf', markdown: '# Hello' }), { status: 200 })
    );
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await convertToMarkdown(bytes, { mime: PDF, filename: 'x.pdf', markitdownAgentBaseUrl: baseUrl });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://localhost:3013/convert');
    expect(result.markdown).toBe('# Hello');
  });

  it('handles markitdown-agent errors with a clear thrown error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      convertToMarkdown(new Uint8Array([1]), { mime: PDF, filename: 'x.pdf', markitdownAgentBaseUrl: baseUrl })
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
