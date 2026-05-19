import { describe, it, expect } from 'vitest';
import { buildDecomposeReferenceTool } from '../tool.js';
import type { ReferenceDoc } from '../types.js';

const fakeRef: ReferenceDoc = {
  id: 'ref-1',
  docType: 'dd-report',
  displayName: 'DD_Memo.docx',
  sourceFilePath: '/tmp/dd-memo.docx',
  sourceMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  contentMarkdown: '# DD Memo\n\n## Executive Summary\n\nBody.',
  designUsable: true,
  warnings: [],
  ingestedAt: new Date().toISOString(),
};

describe('buildDecomposeReferenceTool', () => {
  it('returns a prompt fragment for a known reference', async () => {
    const store = { get: (_id: string) => fakeRef };
    const tool = buildDecomposeReferenceTool(store as never);
    const result = (await tool.execute({ reference_doc_id: 'ref-1' }, {} as never)) as {
      promptFragment?: string;
      designUsable?: boolean;
    };
    expect(result.promptFragment).toContain('REFERENCE DESIGN');
    expect(result.promptFragment).toContain('DD Memo');
    expect(result.designUsable).toBe(true);
  });

  it('returns an error when the reference is missing', async () => {
    const store = { get: () => null };
    const tool = buildDecomposeReferenceTool(store as never);
    const result = (await tool.execute({ reference_doc_id: 'nope' }, {} as never)) as { error?: string };
    expect(result.error).toMatch(/not found/);
  });
});
