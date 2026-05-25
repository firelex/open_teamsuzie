import { describe, it, expect, vi } from 'vitest';
import { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import { InMemoryFileStore } from '../files-route.js';
import { buildDocumentTools } from '../document-tools.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeStores() {
  const fileStore = new InMemoryFileStore();
  const docStore = new InMemoryDocumentStore();
  return { fileStore, docStore };
}

describe('buildDocumentTools', () => {
  it('convert_to_markdown puts the result in docStore and returns doc_id + _doc_state', async () => {
    const { fileStore, docStore } = makeStores();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ filename: 'sample.pdf', markdown: '# Heading\n\nBody' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    fileStore.put({
      id: 'f1', sessionId: 'sess', name: 'sample.pdf', mimeType: 'application/pdf',
      size: 4, bytes: Buffer.from('xxxx'), createdAt: 0,
    });

    const tools = buildDocumentTools({
      sessionId: 'sess', fileStore, docStore,
      markitdownBaseUrl: 'http://md.test', fetchImpl,
    });
    const convert = tools.find((t) => t.name === 'convert_to_markdown');
    expect(convert).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await convert!.execute({ file_id: 'f1' }, { approvals: {} as any, vectorDbBaseUrl: '' });
    expect(result).toMatchObject({
      title: 'sample.pdf',
      _doc_state: expect.objectContaining({ markdown: expect.stringContaining('Heading') }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docId = (result as any).doc_id as string;
    expect(docStore.get('sess', docId)).toBeDefined();
  });

  it('registers drafting tools (including export_to_docx) when markitdown is configured', () => {
    const { fileStore, docStore } = makeStores();
    const tools = buildDocumentTools({
      sessionId: 'sess', fileStore, docStore, markitdownBaseUrl: 'http://md.test',
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('convert_to_markdown');
    expect(names).toContain('create_document');
    expect(names).toContain('export_to_docx');
    expect(names).toContain('get_outline');
    expect(names).toContain('find_in_document');
    expect(names).toContain('compare_documents');
    expect(names).toContain('generate_docx');
  });

  it('omits export_to_docx when markitdown is not configured', () => {
    const { fileStore, docStore } = makeStores();
    const tools = buildDocumentTools({
      sessionId: 'sess', fileStore, docStore, markitdownBaseUrl: '',
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('create_document');
    expect(names).not.toContain('export_to_docx');
    // generate_docx works without markitdown — it's pure docx synthesis.
    expect(names).toContain('generate_docx');
  });

  it('omits all drafting tools when includeDrafting=false (convert + nav + find + compare still present)', () => {
    const { fileStore, docStore } = makeStores();
    const tools = buildDocumentTools({
      sessionId: 'sess', fileStore, docStore,
      markitdownBaseUrl: 'http://md.test', includeDrafting: false,
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('convert_to_markdown');
    expect(names).toContain('get_outline');
    expect(names).toContain('find_in_document');
    expect(names).toContain('compare_documents');
    expect(names).not.toContain('create_document');
    expect(names).not.toContain('export_to_docx');
    expect(names).not.toContain('generate_docx');
  });

  it('export_to_docx stashes DOCX in fileStore and returns a download URL', async () => {
    const { fileStore, docStore } = makeStores();
    // markitdown-agent stub: returns a tiny DOCX blob.
    const docxBytes = Buffer.from('PK\x03\x04docx-content');
    const fetchImpl = vi.fn(async () =>
      new Response(docxBytes, {
        status: 200,
        headers: { 'content-type': DOCX_MIME },
      }),
    ) as unknown as typeof fetch;

    const tools = buildDocumentTools({
      sessionId: 'sess', fileStore, docStore,
      markitdownBaseUrl: 'http://md.test', fetchImpl,
    });

    // Create a doc first via create_document.
    const create = tools.find((t) => t.name === 'create_document')!;
    const exportTool = tools.find((t) => t.name === 'export_to_docx')!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await create.execute({ title: 'Offer Letter' }, { approvals: {} as any, vectorDbBaseUrl: '' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docId = (created as any).doc_id as string;

    const exported = await exportTool.execute(
      { doc_id: docId, filename: 'offer' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '' },
    );
    expect(exported).toMatchObject({
      ok: true,
      filename: 'offer.docx',
      downloadUrl: expect.stringMatching(/^\/api\/files\/sess\/file_export_/),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileId = (exported as any).fileId as string;
    const rec = fileStore.get('sess', fileId);
    expect(rec).toBeDefined();
    expect(rec!.mimeType).toBe(DOCX_MIME);
  });
});
