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
  it('returns stats + markdown + downloadable redline DOCX for two changed DOCXs', async () => {
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
    expect(r.stats.modified).toBeGreaterThanOrEqual(1);
    expect(r.summary).toMatch(/modified/);
    expect(r.markdown).toContain('Comparing');
    expect(r.download_url).toMatch(/^\/api\/files\/s\/file_redline_/);
    expect(r.download_filename).toContain('.docx');
    const fileId = r.download_file_id as string;
    const rec = fileStore.get('s', fileId);
    expect(rec).toBeDefined();
    expect(rec!.mimeType).toBe(DOCX_MIME);
  });

  it('reports identical when both DOCXs are the same content', async () => {
    const fileStore = new InMemoryFileStore();
    // Same title intentionally — the generated docx renders title as a
    // top-level paragraph, so differing titles would show up as one
    // modified paragraph.
    await putDocx(fileStore, 'L', 'same.docx', ['Identical paragraph one.']);
    await putDocx(fileStore, 'R', 'same.docx', ['Identical paragraph one.']);

    const tool = buildCompareDocumentsTool({
      sessionId: 's', fileStore, markitdownBaseUrl: '',
    });
    const result = await tool.execute(
      { left_file_id: 'L', right_file_id: 'R' },
      ctx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.stats.modified).toBe(0);
    expect(r.stats.deleted).toBe(0);
    expect(r.stats.inserted).toBe(0);
    expect(r.markdown).toContain('identical');
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
