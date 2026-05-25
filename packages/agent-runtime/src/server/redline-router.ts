import { Router, type Request, type Response } from 'express';
import {
  acceptRevision, extractRedlineParagraphs, loadDocx, rejectRevision, saveDocx,
} from '@teamsuzie/docx';
import type { InMemoryFileStore } from './files-route.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isDocxRecord(rec: { name: string; mimeType: string }): boolean {
  return rec.name.toLowerCase().endsWith('.docx') || rec.mimeType === DOCX_MIME;
}

export interface RedlineRouterOptions {
  fileStore: InMemoryFileStore;
  versionsStore: {
    addVersion(input: {
      externalDocId: string;
      parentId?: string | null;
      source: 'accept' | 'reject';
      storageId: string;
      byteSize?: number | null;
      notes?: string | null;
    }): { id: string };
  };
}

/**
 * Redline endpoints. Mounted under `/api/files` so the URLs match
 * suzielaw's existing convention:
 *
 *   GET  /api/files/:sessionId/:fileId/redline-view
 *   POST /api/files/:sessionId/:fileId/revisions/resolve
 *
 * The router is independent from `createFilesRouter` so the
 * ModuleRegistry can mount it conditionally (only when `modules.redline`
 * is enabled).
 */
export function createRedlineRouter(opts: RedlineRouterOptions): Router {
  const router: Router = Router();
  const { fileStore, versionsStore } = opts;

  router.get('/:sessionId/:fileId/redline-view', (req: Request, res: Response) => {
    const sessionId = String(req.params.sessionId ?? '');
    const fileId = String(req.params.fileId ?? '');
    const rec = fileStore.get(sessionId, fileId);
    if (!rec) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!isDocxRecord(rec)) {
      res.status(400).json({ error: 'redline_view requires a .docx file' });
      return;
    }
    try {
      const paragraphs = extractRedlineParagraphs(rec.bytes);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ paragraphs });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'extract failed',
      });
    }
  });

  router.post('/:sessionId/:fileId/revisions/resolve', (req, res) => {
    const sessionId = String(req.params.sessionId ?? '');
    const fileId = String(req.params.fileId ?? '');
    const rec = fileStore.get(sessionId, fileId);
    if (!rec) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!isDocxRecord(rec)) {
      res.status(400).json({ error: 'resolve requires a .docx file' });
      return;
    }
    const body = (req.body ?? {}) as { accept?: number[]; reject?: number[] };
    const accept = Array.isArray(body.accept) ? body.accept.map(Number).filter(Number.isFinite) : [];
    const reject = Array.isArray(body.reject) ? body.reject.map(Number).filter(Number.isFinite) : [];
    if (accept.length === 0 && reject.length === 0) {
      res.status(400).json({ error: 'accept or reject must be a non-empty number[]' });
      return;
    }

    try {
      const file = loadDocx(rec.bytes);
      const accepted: number[] = [];
      const rejected: number[] = [];
      for (const id of accept) {
        if (acceptRevision(file, id)) accepted.push(id);
      }
      for (const id of reject) {
        if (rejectRevision(file, id)) rejected.push(id);
      }
      const newBytes = saveDocx(file);

      fileStore.put({
        ...rec,
        bytes: Buffer.from(newBytes),
        size: newBytes.length,
        createdAt: rec.createdAt,
      });

      let versionId: string | undefined;
      const dominantSource: 'accept' | 'reject' = accepted.length > 0 ? 'accept' : 'reject';
      try {
        const v = versionsStore.addVersion({
          externalDocId: fileId,
          parentId: null,
          source: dominantSource,
          storageId: fileId,
          byteSize: newBytes.length,
          notes:
            `Resolved ${accepted.length + rejected.length} revision`
            + (accepted.length + rejected.length === 1 ? '' : 's')
            + ` (${accepted.length} accept, ${rejected.length} reject)`,
        });
        versionId = v.id;
      } catch (err) {
        console.warn(
          '[redline-router] versionsStore.addVersion failed:',
          err instanceof Error ? err.message : err,
        );
      }

      const paragraphs = extractRedlineParagraphs(Buffer.from(newBytes));
      res.json({
        ok: true,
        accepted,
        rejected,
        changed: accepted.length + rejected.length,
        version_id: versionId,
        paragraphs,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'resolve failed',
      });
    }
  });

  return router;
}
