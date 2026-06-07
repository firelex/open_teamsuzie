import { Router, type RequestHandler, type Request, type Response } from 'express';
import multer from 'multer';
import { AttachmentStore, type AttachmentMeta } from '@teamsuzie/artifacts';

export type StoreResolver = (req: Request) => AttachmentStore;

export interface CreateFileRouterOptions {
  /** Static store used for every request. Mutually exclusive with `resolveStore`. */
  store?: AttachmentStore;
  /**
   * Per-request store resolver. Use this for multi-tenant wire-ups so the
   * router doesn't have to be reconstructed per tenant. Mutually exclusive
   * with `store`.
   */
  resolveStore?: StoreResolver;
  /** Applied before every route. PE platform passes its tenant-context guard here. */
  authMiddleware?: RequestHandler;
  /** Maximum upload size in bytes. Defaults to 50 MiB. */
  maxUploadBytes?: number;
  /** Build the user-facing URL placed on the upload response. */
  urlForMeta?: (meta: AttachmentMeta) => string;
}

const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface MetaResponse extends AttachmentMeta {
  url?: string;
}

function toResponse(meta: AttachmentMeta, urlForMeta?: (m: AttachmentMeta) => string): MetaResponse {
  const url = urlForMeta?.(meta);
  return url ? { ...meta, url } : meta;
}

export function createFileRouter(options: CreateFileRouterOptions): Router {
  if (!options.store === !options.resolveStore) {
    throw new Error('createFileRouter: provide exactly one of `store` or `resolveStore`');
  }
  const resolve: StoreResolver = options.resolveStore ?? (() => options.store!);
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES },
  });

  if (options.authMiddleware) {
    router.use(options.authMiddleware);
  }

  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'missing file' });
      return;
    }
    try {
      const meta = resolve(req).save({
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        bytes: req.file.buffer,
      });
      res.status(200).json(toResponse(meta, options.urlForMeta));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'save failed';
      const status = /unsupported/i.test(message) ? 415 : /size limit/i.test(message) ? 413 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.get('/:id/meta', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const meta = resolve(req).readMeta(id);
    if (!meta) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(toResponse(meta, options.urlForMeta));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const loaded = resolve(req).readBytes(id);
    if (!loaded) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.setHeader('Content-Type', loaded.meta.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${loaded.meta.filename.replace(/"/g, '')}"`,
    );
    res.status(200).send(loaded.bytes);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    resolve(req).delete(id);
    res.status(204).end();
  });

  return router;
}
