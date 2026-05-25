import { describe, it, expect, vi } from 'vitest';
import { buildProposeDocumentEditsTool } from '../propose-edits-tool.js';

// A trivial minimal DOCX would be cumbersome; mock proposeDocumentEdits
// to isolate the tool wrapper behavior.
vi.mock('../propose-edits.js', () => ({
  proposeDocumentEdits: vi.fn(() => ({
    bytes: Buffer.from('proposed-bytes'),
    applied_count: 1,
    total: 1,
    summary: 'Applied 1 of 1 edit',
    errors: [],
    applied_edits: [
      {
        index: 0,
        find: 'Buyer',
        replace: 'Purchaser',
        context_before: 'against ',
        context_after: ' on the date',
        reason: 'consistency',
        revision_ids: [1],
        paragraph_index: 3,
      },
    ],
  })),
}));

describe('buildProposeDocumentEditsTool', () => {
  it('writes new file + version then returns wire shape', async () => {
    const put = vi.fn();
    const fileStore = {
      get: () => ({
        id: 'src',
        sessionId: 'sess',
        name: 'nda.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 1,
        bytes: Buffer.from('docx-bytes'),
        createdAt: 0,
      }),
      put,
    };
    const versionsStore = { addVersion: vi.fn(() => ({ id: 'v2' })) };

    const tool = buildProposeDocumentEditsTool({
      fileStore,
      versionsStore,
      author: 'AI assistant',
      buildDownloadUrl: (sid, fid) => `/api/files/${sid}/${fid}/content`,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = { approvals: {} as any, vectorDbBaseUrl: '', sessionId: 'sess' };
    const result = await tool.execute(
      {
        file_id: 'src',
        edits: [
          { find: 'Buyer', replace: 'Purchaser', context_before: 'a', context_after: 'b' },
        ],
      },
      ctx,
    );

    expect(put).toHaveBeenCalledOnce();
    expect(versionsStore.addVersion).toHaveBeenCalledWith(expect.objectContaining({
      source: 'proposal',
    }));
    expect(result).toMatchObject({
      applied_count: 1,
      total: 1,
      summary: expect.any(String),
      download_url: expect.stringMatching(/^\/api\/files\/sess\//),
      download_session_id: 'sess',
      download_filename: expect.stringContaining('.docx'),
      version_id: 'v2',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).bytes).toBeUndefined();
  });

  it('errors when sessionId missing', async () => {
    const tool = buildProposeDocumentEditsTool({
      fileStore: { get: () => undefined, put: () => {} },
      versionsStore: { addVersion: () => ({ id: 'v' }) },
      author: 'X',
      buildDownloadUrl: () => '',
    });
    const result = await tool.execute(
      { file_id: 'f', edits: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '' },
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/sessionId/) });
  });

  it('errors when file is not a .docx', async () => {
    const tool = buildProposeDocumentEditsTool({
      fileStore: {
        get: () => ({
          id: 'src', sessionId: 's', name: 'note.txt',
          mimeType: 'text/plain', size: 1, bytes: Buffer.from('x'), createdAt: 0,
        }),
        put: () => {},
      },
      versionsStore: { addVersion: () => ({ id: 'v' }) },
      author: 'X',
      buildDownloadUrl: () => '',
    });
    const result = await tool.execute(
      { file_id: 'src', edits: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '', sessionId: 's' },
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/\.docx/i) });
  });
});
