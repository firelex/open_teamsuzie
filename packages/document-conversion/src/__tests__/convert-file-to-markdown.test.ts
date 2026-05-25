import { describe, it, expect, vi } from 'vitest';
import { convertFileToMarkdown } from '../convert.js';

describe('convertFileToMarkdown', () => {
  it('routes a non-DOCX binary through markitdown-agent', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ filename: 'doc.pdf', markdown: '# Hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const md = await convertFileToMarkdown(
      { name: 'doc.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x') },
      { markitdownAgentBaseUrl: 'http://md.test', fetchImpl },
    );
    expect(md).toBe('# Hello');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws a friendly error for non-DOCX binaries when markitdown is unset', async () => {
    await expect(
      convertFileToMarkdown(
        { name: 'doc.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x') },
        { markitdownAgentBaseUrl: '' },
      ),
    ).rejects.toThrow(/markitdown-agent is not configured/);
  });
});
