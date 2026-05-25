import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '@teamsuzie/db-sqlite';
import {
  DocumentVersionsStore, DOCUMENT_VERSIONS_MIGRATIONS,
} from '@teamsuzie/document-versions';
import { generateDocx, buildProposeDocumentEditsTool } from '@teamsuzie/docx';
import { createFilesRouter, InMemoryFileStore } from '../files-route.js';
import { createRedlineRouter } from '../redline-router.js';

describe('redline round-trip', () => {
  it('propose → redline-view shows ins/del → resolve(accept) → view reflects accepted', async () => {
    const db = openDb({ path: ':memory:', migrations: [...DOCUMENT_VERSIONS_MIGRATIONS] });
    const fileStore = new InMemoryFileStore();
    const versionsStore = new DocumentVersionsStore({ db });

    const app = express();
    app.use(express.json());
    app.use('/api', createFilesRouter({ store: fileStore, versionsStore }));
    app.use('/api/files', createRedlineRouter({ fileStore, versionsStore }));

    // 1. Generate a base .docx in memory.
    const baseBytes = await generateDocx({
      title: 'NDA',
      sections: [
        {
          heading: { text: 'Confidentiality', level: 1 },
          paragraphs: ['The Buyer shall keep all Confidential Information secret.'],
        },
      ],
    });

    // 2. Upload it.
    const upload = await request(app)
      .post('/api/files')
      .field('sessionId', 'sess-rt')
      .attach('file', Buffer.from(baseBytes), 'nda.docx');
    expect(upload.status).toBe(201);
    const baseFileId = upload.body.item.id as string;

    // 3. Propose an edit via the tool directly (bypassing the chat loop).
    const tool = buildProposeDocumentEditsTool({
      fileStore,
      versionsStore,
      author: 'Test',
      buildDownloadUrl: (sid, fid) => `/api/files/${sid}/${fid}/content`,
    });
    const proposeResult = await tool.execute(
      {
        file_id: baseFileId,
        edits: [
          {
            find: 'Buyer',
            replace: 'Purchaser',
            context_before: 'The ',
            context_after: ' shall keep',
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { approvals: {} as any, vectorDbBaseUrl: '', sessionId: 'sess-rt' },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((proposeResult as any).applied_count).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proposalFileId = (proposeResult as any).download_file_id as string;

    // 4. GET /redline-view shows ins/del runs.
    const view1 = await request(app).get(`/api/files/sess-rt/${proposalFileId}/redline-view`);
    expect(view1.status).toBe(200);
    const paragraphs1 = view1.body.paragraphs as Array<{ runs: Array<{ kind: string; revisionId?: number }> }>;
    const hasIns = paragraphs1.some((p) => p.runs.some((r) => r.kind === 'insert'));
    const hasDel = paragraphs1.some((p) => p.runs.some((r) => r.kind === 'delete'));
    expect(hasIns).toBe(true);
    expect(hasDel).toBe(true);

    // 5. Resolve(accept all ins/del ids).
    const revIds = new Set<number>();
    for (const p of paragraphs1) {
      for (const r of p.runs) if (r.revisionId !== undefined) revIds.add(r.revisionId);
    }
    expect(revIds.size).toBeGreaterThan(0);
    const resolve = await request(app)
      .post(`/api/files/sess-rt/${proposalFileId}/revisions/resolve`)
      .send({ accept: [...revIds] });
    expect(resolve.status).toBe(200);
    expect(resolve.body.ok).toBe(true);
    expect(resolve.body.accepted.length).toBe(revIds.size);
    expect(resolve.body.version_id).toBeDefined();

    // 6. After accept, the view has no ins/del runs.
    const view2 = await request(app).get(`/api/files/sess-rt/${proposalFileId}/redline-view`);
    expect(view2.status).toBe(200);
    const paragraphs2 = view2.body.paragraphs as Array<{ runs: Array<{ kind: string }> }>;
    const stillHasRevisions = paragraphs2.some((p) =>
      p.runs.some((r) => r.kind === 'insert' || r.kind === 'delete'),
    );
    expect(stillHasRevisions).toBe(false);
  });
});
