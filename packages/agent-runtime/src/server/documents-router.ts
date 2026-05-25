import { Router, type Request, type Response } from 'express';
import type { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import type { InMemoryFileStore } from './files-route.js';
import { exportDocFromMarkdown } from './document-tools.js';

export interface DocumentsRouterOptions {
  fileStore: InMemoryFileStore;
  docStore: InMemoryDocumentStore;
  /**
   * markitdown-agent base URL. When empty, the export endpoint returns
   * 503; the panel uses that signal to fall back to "not yet exported".
   */
  markitdownBaseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Documents endpoints — user-driven counterparts to the model-driven
 * drafting tools. Mounted unconditionally; absent prerequisites surface
 * as 503/404 rather than missing routes.
 *
 *   POST /api/documents/:sessionId/:docId/export
 *     Body: { filename? }
 *     503 when markitdown-agent isn't configured.
 *     404 when the doc isn't in the session's docStore.
 *     200 → { fileId, filename, downloadUrl } — a relative URL the
 *           client can navigate to / pass to <a download> to grab the
 *           DOCX from /api/files.
 */
export function createDocumentsRouter(opts: DocumentsRouterOptions): Router {
  const router: Router = Router();
  const { fileStore, docStore, markitdownBaseUrl, fetchImpl } = opts;

  router.post('/:sessionId/:docId/export', async (req: Request, res: Response) => {
    if (!markitdownBaseUrl) {
      res.status(503).json({ error: 'markitdown-agent is not configured' });
      return;
    }
    const sessionId = String(req.params.sessionId ?? '');
    const docId = String(req.params.docId ?? '');
    const doc = docStore.get(sessionId, docId);
    if (!doc) {
      res.status(404).json({ error: 'document not found' });
      return;
    }
    const body = (req.body ?? {}) as { filename?: string };
    const requested = (body.filename ?? doc.title ?? 'document').toString();
    const stem = requested.replace(/[^\w.-]+/g, '_').replace(/\.docx$/i, '') || 'document';

    try {
      const result = await exportDocFromMarkdown({
        sessionId,
        markdown: doc.getMarkdown(),
        filename: stem,
        markitdownBaseUrl,
        fileStore,
        fetchImpl,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'export failed',
      });
    }
  });

  return router;
}
