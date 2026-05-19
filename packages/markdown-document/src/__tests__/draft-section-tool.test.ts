import { describe, it, expect, vi } from 'vitest';
import { InMemoryDocumentStore } from '../store.js';
import { buildDraftSectionTool } from '../draft-section-tool.js';

const noopCtx = {} as Parameters<ReturnType<typeof buildDraftSectionTool>['execute']>[1];

describe('draft_section tool', () => {
  it('returns error when section_prompt is missing', async () => {
    const tool = buildDraftSectionTool({ llmCall: async () => 'x' });
    const result = (await tool.execute({ section_prompt: '' }, noopCtx)) as { error?: string };
    expect(result.error).toMatch(/Missing section_prompt/);
  });

  it('invokes the LLM with a composed prompt and returns prose', async () => {
    const llm = vi.fn(async () => '   This is the drafted section.   ');
    const tool = buildDraftSectionTool({ llmCall: llm });
    const result = (await tool.execute({ section_prompt: 'Executive summary of Project Meridian deal' }, noopCtx)) as { prose?: string };
    expect(llm).toHaveBeenCalledOnce();
    expect(llm.mock.calls[0][0]).toMatch(/Project Meridian/);
    expect(result.prose).toBe('This is the drafted section.');
  });

  it('honors max_words by passing it through into the prompt', async () => {
    const llm = vi.fn(async () => 'ok');
    const tool = buildDraftSectionTool({ llmCall: llm });
    await tool.execute({ section_prompt: 'X', max_words: 100 }, noopCtx);
    expect(llm.mock.calls[0][0]).toMatch(/about 100 words/);
  });

  it('falls back to stateless { prose } when no docStore is wired', async () => {
    const tool = buildDraftSectionTool({ llmCall: async () => 'just prose' });
    const result = (await tool.execute({ section_prompt: 'X' }, noopCtx)) as {
      prose?: string;
      _doc_state?: unknown;
      doc_id?: unknown;
    };
    expect(result.prose).toBe('just prose');
    expect(result._doc_state).toBeUndefined();
    expect(result.doc_id).toBeUndefined();
  });

  it('stamps _doc_state when wired with a docStore', async () => {
    const docStore = new InMemoryDocumentStore();
    const tool = buildDraftSectionTool({
      llmCall: async () => 'first paragraph',
      docStore,
      getSessionId: () => 'sess-1',
      getDocKey: () => 'draft-sess-1-default',
    });
    const result = (await tool.execute(
      { section_prompt: 'X', heading: 'Background' },
      noopCtx,
    )) as {
      prose?: string;
      doc_id?: string;
      _doc_state?: { doc_id: string; title: string; markdown: string };
    };
    expect(result.prose).toBe('first paragraph');
    expect(result.doc_id).toBe('draft-sess-1-default');
    expect(result._doc_state).toBeDefined();
    expect(result._doc_state!.title).toBe('Working Draft');
    expect(result._doc_state!.markdown).toContain('## Background');
    expect(result._doc_state!.markdown).toContain('first paragraph');
  });

  it('accumulates successive sections into the same per-workflow doc', async () => {
    const docStore = new InMemoryDocumentStore();
    const proseQueue = ['first paragraph', 'second paragraph'];
    const tool = buildDraftSectionTool({
      llmCall: async () => proseQueue.shift() ?? '',
      docStore,
      getSessionId: () => 'sess-1',
      getDocKey: () => 'draft-sess-1-offer-letter',
    });

    const first = (await tool.execute(
      { section_prompt: 'A', heading: 'Background' },
      noopCtx,
    )) as { _doc_state?: { markdown: string } };
    const second = (await tool.execute(
      { section_prompt: 'B', heading: 'Terms' },
      noopCtx,
    )) as { _doc_state?: { markdown: string } };

    expect(first._doc_state!.markdown).toContain('## Background');
    expect(first._doc_state!.markdown).toContain('first paragraph');
    expect(second._doc_state!.markdown).toContain('## Background');
    expect(second._doc_state!.markdown).toContain('first paragraph');
    expect(second._doc_state!.markdown).toContain('## Terms');
    expect(second._doc_state!.markdown).toContain('second paragraph');
  });
});
