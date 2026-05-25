import { describe, it, expect } from 'vitest';
import { InMemoryDocumentStore, MarkdownDocument } from '@teamsuzie/markdown-document';
import { generateDocx } from '@teamsuzie/docx';
import { InMemoryFileStore } from '../files-route.js';
import { buildFindInDocumentTool } from '../find-in-document-tool.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function ctx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { approvals: {} as any, vectorDbBaseUrl: '' };
}

describe('buildFindInDocumentTool', () => {
  it('searches a DOCX by body-paragraph and returns paragraph indices', async () => {
    const bytes = await generateDocx({
      title: 'NDA',
      sections: [
        {
          heading: { text: 'Confidentiality', level: 1 },
          paragraphs: [
            'The Buyer shall keep all Confidential Information secret.',
            'The Seller may disclose information to its advisors.',
          ],
        },
      ],
    });
    const fileStore = new InMemoryFileStore();
    fileStore.put({
      id: 'f1', sessionId: 's', name: 'nda.docx', mimeType: DOCX_MIME,
      size: bytes.length, bytes: Buffer.from(bytes), createdAt: 0,
    });

    const tool = buildFindInDocumentTool({
      sessionId: 's',
      fileStore,
      docStore: new InMemoryDocumentStore(),
    });
    const result = await tool.execute({ file_id: 'f1', query: 'Buyer' }, ctx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.total_matches).toBeGreaterThanOrEqual(1);
    expect(r.matches[0]).toMatchObject({
      position: expect.any(Number),
      snippet: expect.stringContaining('Buyer'),
    });
  });

  it('case-sensitive flag is respected', async () => {
    const bytes = await generateDocx({
      title: 'X',
      sections: [{ paragraphs: ['Hello world. HELLO WORLD.'] }],
    });
    const fileStore = new InMemoryFileStore();
    fileStore.put({
      id: 'f1', sessionId: 's', name: 'x.docx', mimeType: DOCX_MIME,
      size: bytes.length, bytes: Buffer.from(bytes), createdAt: 0,
    });
    const tool = buildFindInDocumentTool({
      sessionId: 's', fileStore, docStore: new InMemoryDocumentStore(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ins = (await tool.execute({ file_id: 'f1', query: 'Hello' }, ctx())) as any;
    expect(ins.total_matches).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sens = (await tool.execute({ file_id: 'f1', query: 'HELLO', case_sensitive: true }, ctx())) as any;
    expect(sens.total_matches).toBe(1);
  });

  it('returns document_not_converted error when non-DOCX file has no docStore entry', async () => {
    const fileStore = new InMemoryFileStore();
    fileStore.put({
      id: 'f1', sessionId: 's', name: 'note.pdf', mimeType: 'application/pdf',
      size: 4, bytes: Buffer.from('PDF.'), createdAt: 0,
    });
    const tool = buildFindInDocumentTool({
      sessionId: 's', fileStore, docStore: new InMemoryDocumentStore(),
    });
    const result = await tool.execute({ file_id: 'f1', query: 'PDF' }, ctx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.error).toMatch(/document_not_converted/);
    expect(r.matches).toEqual([]);
  });

  it('searches a converted markdown document with heading paths', async () => {
    const fileStore = new InMemoryFileStore();
    fileStore.put({
      id: 'f1', sessionId: 's', name: 'note.pdf', mimeType: 'application/pdf',
      size: 4, bytes: Buffer.from('PDF.'), createdAt: 0,
    });
    const docStore = new InMemoryDocumentStore();
    docStore.put('s', new MarkdownDocument(
      '# Terms\n\nThe escrow is funded at closing.\n\n## Escrow\n\nThe escrow lasts 24 months.',
      'note.pdf',
    ));
    const tool = buildFindInDocumentTool({ sessionId: 's', fileStore, docStore });
    const result = await tool.execute({ file_id: 'f1', query: 'escrow' }, ctx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.total_matches).toBeGreaterThanOrEqual(2);
    // The second match (under ## Escrow) carries a heading_path.
    expect(r.matches.some((m: { heading_path?: string }) => m.heading_path === 'Terms › Escrow')).toBe(true);
  });

  it('throws when the file_id is unknown', async () => {
    const tool = buildFindInDocumentTool({
      sessionId: 's',
      fileStore: new InMemoryFileStore(),
      docStore: new InMemoryDocumentStore(),
    });
    await expect(tool.execute({ file_id: 'ghost', query: 'x' }, ctx())).rejects.toThrow(/not found/);
  });
});
