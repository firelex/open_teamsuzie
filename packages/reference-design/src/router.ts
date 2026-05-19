import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { ReferenceStore } from './storage-sqlite.js';

export function createReferencesRouter(store: ReferenceStore): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'Missing file' });
      return;
    }
    const docType = (req.body as { doc_type?: string }).doc_type;
    if (!docType) {
      res.status(400).json({ error: 'Missing doc_type' });
      return;
    }
    try {
      const ref = await store.ingest(req.file.buffer, {
        mime: req.file.mimetype,
        originalName: req.file.originalname,
        docType,
      });
      res.status(201).json(ref);
    } catch (err) {
      console.error('Reference ingestion failed', err);
      res.status(500).json({ error: String((err as Error).message ?? err) });
    }
  });

  router.get('/', (req: Request, res: Response) => {
    res.json(store.list(typeof req.query.doc_type === 'string' ? req.query.doc_type : undefined));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const ref = store.get(String(req.params.id));
    if (!ref) res.status(404).end();
    else res.json(ref);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    store.delete(String(req.params.id));
    res.status(204).end();
  });

  return router;
}
