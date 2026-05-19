import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mock the export functions BEFORE importing the module under test.
vi.mock('../export.js', () => ({
  exportMarkdownToDocx: vi.fn(async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
  exportMarkdownToPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
}));

import { buildGenerateDocxTool, buildGeneratePdfTool } from '../output-tools.js';

describe('buildGenerateDocxTool', () => {
  it('returns error on missing markdown', async () => {
    const tool = buildGenerateDocxTool({
      store: { get: () => null },
      markitdownAgentBaseUrl: 'http://stub',
      outputsDir: mkdtempSync(path.join(tmpdir(), 'gen-docx-')),
    });
    const result = (await tool.execute({ markdown: '', filename: 'x' }, {} as never)) as { error?: string };
    expect(result.error).toMatch(/Missing markdown/);
  });

  it('writes a docx for non-empty markdown with no reference', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'gen-docx-'));
    const tool = buildGenerateDocxTool({
      store: { get: () => null },
      markitdownAgentBaseUrl: 'http://stub',
      outputsDir: out,
    });
    const result = (await tool.execute({ markdown: '# Hi', filename: 'hello' }, {} as never)) as {
      ok?: boolean; path?: string; bytes?: number;
    };
    expect(result.ok).toBe(true);
    expect(result.path).toMatch(/hello-\d+\.docx$/);
    expect(result.bytes).toBe(4);
  });
});

describe('buildGeneratePdfTool', () => {
  it('returns error on missing markdown', async () => {
    const tool = buildGeneratePdfTool({
      store: { get: () => null },
      markitdownAgentBaseUrl: 'http://stub',
      outputsDir: mkdtempSync(path.join(tmpdir(), 'gen-pdf-')),
    });
    const result = (await tool.execute({ markdown: '', filename: 'x' }, {} as never)) as { error?: string };
    expect(result.error).toMatch(/Missing markdown/);
  });

  it('writes a pdf for non-empty markdown', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'gen-pdf-'));
    const tool = buildGeneratePdfTool({
      store: { get: () => null },
      markitdownAgentBaseUrl: 'http://stub',
      outputsDir: out,
    });
    const result = (await tool.execute({ markdown: '# Hi', filename: 'hello' }, {} as never)) as {
      ok?: boolean; path?: string; bytes?: number;
    };
    expect(result.ok).toBe(true);
    expect(result.path).toMatch(/hello-\d+\.pdf$/);
    expect(result.bytes).toBe(4);
  });
});
