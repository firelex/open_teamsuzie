import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportMarkdownToDocx, exportMarkdownToPdf } from '../export.js';

// Mock @teamsuzie/pdf so exportMarkdownToPdf is unit-testable without soffice.
vi.mock('@teamsuzie/pdf', () => ({
  convertDocxBufferToPdf: vi.fn(async (_docx: Buffer) => Buffer.from([0x25, 0x50, 0x44, 0x46])), // '%PDF'
  isLibreOfficeAvailable: () => true,
}));

const baseUrl = 'http://localhost:3013';

describe('exportMarkdownToDocx', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts JSON when no reference is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }),
    );
    const bytes = await exportMarkdownToDocx({
      markdown: '# Hi',
      filename: 'hi',
      markitdownAgentBaseUrl: baseUrl,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(bytes.byteLength).toBe(2);
  });

  it('posts multipart when a reference is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }),
    );
    await exportMarkdownToDocx({
      markdown: '# Hi',
      filename: 'hi',
      referenceDoc: { bytes: new Uint8Array([1]), filename: 'ref.docx' },
      markitdownAgentBaseUrl: baseUrl,
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      exportMarkdownToDocx({ markdown: '# X', markitdownAgentBaseUrl: baseUrl }),
    ).rejects.toThrow(/markitdown-agent.*500/);
  });
});

describe('exportMarkdownToPdf', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns PDF bytes via the DOCX → PDF pipeline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200 }),
    );
    const bytes = await exportMarkdownToPdf({
      markdown: '# Hi',
      filename: 'hi',
      markitdownAgentBaseUrl: baseUrl,
    });
    // Returns the mocked %PDF bytes from @teamsuzie/pdf.
    expect(bytes.byteLength).toBe(4);
    expect(bytes[0]).toBe(0x25); // %
  });
});
