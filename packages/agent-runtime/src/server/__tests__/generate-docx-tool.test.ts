import { describe, it, expect, vi } from 'vitest';
import { InMemoryFileStore } from '../files-route.js';
import { buildGenerateDocxFromSpecTool } from '../generate-docx-tool.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function ctx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { approvals: {} as any, vectorDbBaseUrl: '' };
}

describe('buildGenerateDocxFromSpecTool', () => {
  it('renders a structured DOCX, stashes it in fileStore, returns suzielaw wire shape', async () => {
    const fileStore = new InMemoryFileStore();
    const tool = buildGenerateDocxFromSpecTool({ sessionId: 's', fileStore });

    const result = await tool.execute({
      title: 'CP Checklist',
      orientation: 'landscape',
      sections: [
        {
          heading: { text: 'Condition Precedents', level: 1 },
          table: {
            headers: ['#', 'Condition', 'Owner', 'Status'],
            rows: [
              ['1', 'Antitrust clearance', 'Counsel', 'Pending'],
              ['2', 'Lender consent', 'CFO', 'Done'],
            ],
          },
        },
      ],
    }, ctx());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    expect(r.download_url).toMatch(/^\/api\/files\/s\/file_generated_/);
    expect(r.download_filename).toBe('CP_Checklist.docx');
    expect(r.section_count).toBe(1);
    expect(r.version_id).toBeUndefined();
    const fileId = r.download_file_id as string;
    const rec = fileStore.get('s', fileId);
    expect(rec).toBeDefined();
    expect(rec!.mimeType).toBe(DOCX_MIME);
    expect(rec!.size).toBeGreaterThan(0);
  });

  it('records a generated version when versionsStore is provided', async () => {
    const fileStore = new InMemoryFileStore();
    const addVersion = vi.fn(() => ({ id: 'ver-1' }));
    const tool = buildGenerateDocxFromSpecTool({
      sessionId: 's', fileStore,
      versionsStore: { addVersion },
    });
    const result = await tool.execute({
      title: 'Diligence',
      sections: [{ paragraphs: ['p1'] }],
    }, ctx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).version_id).toBe('ver-1');
    expect(addVersion).toHaveBeenCalledWith(expect.objectContaining({
      source: 'generated',
      notes: expect.stringContaining('Diligence'),
    }));
  });

  it('throws when title is missing or blank', async () => {
    const tool = buildGenerateDocxFromSpecTool({
      sessionId: 's', fileStore: new InMemoryFileStore(),
    });
    await expect(
      tool.execute({ title: '', sections: [] }, ctx()),
    ).rejects.toThrow(/title is required/);
  });

  it('throws when sections is not an array', async () => {
    const tool = buildGenerateDocxFromSpecTool({
      sessionId: 's', fileStore: new InMemoryFileStore(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      tool.execute({ title: 'X', sections: 'oops' as any }, ctx()),
    ).rejects.toThrow(/sections must be an array/);
  });

  it('sanitizes title for the output filename', async () => {
    const fileStore = new InMemoryFileStore();
    const tool = buildGenerateDocxFromSpecTool({ sessionId: 's', fileStore });
    const result = await tool.execute({
      title: 'Term sheet / draft #2 (revised)',
      sections: [],
    }, ctx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).download_filename).toBe('Term_sheet_draft_2_revised.docx');
  });
});
