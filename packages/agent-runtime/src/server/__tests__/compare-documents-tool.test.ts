import { describe, it, expect } from 'vitest';
import { generateDocx } from '@teamsuzie/docx';
import { InMemoryFileStore } from '../files-route.js';
import { buildCompareDocumentsTool } from '../compare-documents-tool.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function ctx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { approvals: {} as any, vectorDbBaseUrl: '' };
}

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

describe('buildCompareDocumentsTool', () => {
  it('calls the summarizer and returns its topics in the result', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'L', 'nda-v1.docx', ['The Buyer keeps it secret.']);
    await putDocx(fileStore, 'R', 'nda-v2.docx', ['The Purchaser keeps it secret.']);
    let summarizerCalled = false;
    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore, markitdownBaseUrl: '',
      summarize: async ({ leftName, rightName }) => {
        summarizerCalled = true;
        return [
          { topic: 'Party name', left: leftName, right: rightName },
        ];
      },
    });
    const result = await tool.execute(
      { left_file_id: 'L', right_file_id: 'R' },
      ctx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(summarizerCalled).toBe(true);
    expect(r.topics).toEqual([
      { topic: 'Party name', left: 'nda-v1.docx', right: 'nda-v2.docx' },
    ]);
    // events stream still returned as fallback.
    expect(Array.isArray(r.events)).toBe(true);
  });

  it('falls back gracefully when summarizer throws (topics undefined, events present)', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'L', 'a.docx', ['First version.']);
    await putDocx(fileStore, 'R', 'b.docx', ['Second version.']);
    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore, markitdownBaseUrl: '',
      summarize: async () => { throw new Error('LLM is on fire'); },
    });
    const result = await tool.execute(
      { left_file_id: 'L', right_file_id: 'R' },
      ctx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.topics).toBeUndefined();
    expect(Array.isArray(r.events)).toBe(true);
  });

  it('falls back gracefully when summarizer returns null', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'L', 'a.docx', ['v1']);
    await putDocx(fileStore, 'R', 'b.docx', ['v2']);
    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore, markitdownBaseUrl: '',
      summarize: async () => null,
    });
    const result = await tool.execute(
      { left_file_id: 'L', right_file_id: 'R' },
      ctx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).topics).toBeUndefined();
  });

  it('returns the full DocumentDiffResult (events, stats, markdown) and NO download URL', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'L', 'nda-v1.docx', [
      'The Buyer shall keep the information secret for two years.',
      'The Seller may share information with its advisors.',
    ]);
    await putDocx(fileStore, 'R', 'nda-v2.docx', [
      'The Purchaser shall keep the information secret for three years.',
      'The Seller may share information with its advisors.',
    ]);

    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore, markitdownBaseUrl: '',
    });
    const result = await tool.execute(
      { left_file_id: 'L', right_file_id: 'R' },
      ctx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.left?.name).toBe('nda-v1.docx');
    expect(r.right?.name).toBe('nda-v2.docx');
    expect(r.stats.modified).toBeGreaterThanOrEqual(1);
    expect(r.summary).toMatch(/modified/);
    expect(r.markdown).toContain('Comparing');
    expect(Array.isArray(r.events)).toBe(true);
    expect(r.events.some((e: { kind: string }) => e.kind === 'modified')).toBe(true);
    // Critical distinction from blackline_documents: no download URL,
    // no new file in the store. compare_documents is analytical only.
    expect(r.download_url).toBeUndefined();
    expect(r.download_file_id).toBeUndefined();
    expect(fileStore.getMany('s', ['L', 'R']).length).toBe(2); // unchanged
  });

  it('throws when a file_id is missing', async () => {
    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore: new InMemoryFileStore(), markitdownBaseUrl: '',
    });
    await expect(
      tool.execute({ left_file_id: 'ghost', right_file_id: 'phantom' }, ctx()),
    ).rejects.toThrow(/left_file_id not found/);
  });

  it('throws when left and right are the same file', async () => {
    const fileStore = new InMemoryFileStore();
    await putDocx(fileStore, 'X', 'doc.docx', ['Body.']);
    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore, markitdownBaseUrl: '',
    });
    await expect(
      tool.execute({ left_file_id: 'X', right_file_id: 'X' }, ctx()),
    ).rejects.toThrow(/different files/);
  });
});
