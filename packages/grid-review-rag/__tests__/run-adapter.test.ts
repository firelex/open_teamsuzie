import { describe, it, expect } from 'vitest';
import type { ReviewColumn, ReviewDocument } from '@teamsuzie/grid-review';
import { buildRagRunCellAdapter, type RagAdapterOptions } from '../src/run-adapter.js';

function makeStubRag(hits: Array<{ content: string; distance?: number }>) {
  return {
    hasIndex: () => true,
    searchInDoc: async () => hits.map((h, i) => ({
      document: { id: 'doc-1', name: 'CIM.pdf' },
      chunk: { id: `chunk-${i}`, chunkIndex: i, content: h.content },
      distance: h.distance ?? 0.2,
    })),
    searchInWorkspace: async () => [],
  };
}

function makeStubLlm(text: string) {
  return {
    async stream(question: string, _formatKey: string): Promise<string> {
      return `HyDE: ${question}`;
    },
    async *llmStream(): AsyncIterable<string> {
      // Two chunks then done — matches the buildCellMessages prompt; runCell
      // expects the assistant text to contain a citations block, but for
      // this stub we just yield plain text and let parseResponse degrade
      // gracefully (no citations parsed).
      yield text;
    },
  };
}

const stubDocument: ReviewDocument = {
  id: 'row-1',
  reviewId: 'review-1',
  externalDocId: 'doc-1',
  name: 'CIM.pdf',
  mimeType: 'application/pdf',
  position: 0,
  addedAt: Date.now(),
};

const stubColumn: ReviewColumn = {
  id: 'col-1',
  reviewId: 'review-1',
  title: 'Customer concentration',
  prompt: 'Is customer concentration above 20%?',
  format: 'short_text',
  position: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('buildRagRunCellAdapter', () => {
  it('emits `retrieved` then `token` then `done` when RAG returns hits', async () => {
    const stubLlm = makeStubLlm('Yes, top-10 = 78%. <CITATIONS> [doc-1#chunk-0] </CITATIONS>');
    const rag = makeStubRag([{ content: 'Top-10 customers = 78% of revenue' }]);
    const opts: RagAdapterOptions = {
      rag: rag as unknown as RagAdapterOptions['rag'],
      loadFileBytes: async () => null,
      hydeRewrite: async (q) => `HyDE: ${q}`,
      llmStream: () => stubLlm.llmStream(),
      markitdownBaseUrl: 'http://stub',
      topK: 3,
    };
    const adapter = buildRagRunCellAdapter(opts);
    const events: Array<{ type: string }> = [];
    for await (const ev of adapter({
      workspaceId: 'ws-1',
      document: stubDocument,
      column: stubColumn,
    })) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('retrieved');
    expect(types.includes('token')).toBe(true);
    expect(types[types.length - 1]).toBe('done');
  });

  it('emits error event when RAG throws', async () => {
    const stubLlm = makeStubLlm('unused');
    const rag = {
      hasIndex: () => true,
      searchInDoc: async () => { throw new Error('boom'); },
      searchInWorkspace: async () => [],
    };
    const adapter = buildRagRunCellAdapter({
      rag: rag as unknown as RagAdapterOptions['rag'],
      loadFileBytes: async () => null,
      hydeRewrite: async (q) => q,
      llmStream: () => stubLlm.llmStream(),
      markitdownBaseUrl: 'http://stub',
    });
    const events: Array<{ type: string }> = [];
    for await (const ev of adapter({
      workspaceId: 'ws-1',
      document: stubDocument,
      column: stubColumn,
    })) {
      events.push(ev);
    }
    expect(events.find((e) => e.type === 'error')).toBeDefined();
  });
});
