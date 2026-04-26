import { Router, type Request, type Response } from 'express';
import multer from 'multer';

/** Per-session file record. Stored in memory; gone on restart. */
export interface FileRecord {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  bytes: Buffer;
  createdAt: number;
}

/** Public-safe view of a file (no bytes). */
export interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Per-session in-memory file store. Suitable for chat sessions; not for
 * persistent libraries. Replace with disk / S3 / Postgres if you need files
 * to survive restart.
 */
export class InMemoryFileStore {
  private bySession: Map<string, Map<string, FileRecord>> = new Map();

  put(record: FileRecord): void {
    let sess = this.bySession.get(record.sessionId);
    if (!sess) {
      sess = new Map();
      this.bySession.set(record.sessionId, sess);
    }
    sess.set(record.id, record);
  }

  get(sessionId: string, fileId: string): FileRecord | undefined {
    return this.bySession.get(sessionId)?.get(fileId);
  }

  getMany(sessionId: string, fileIds: string[]): FileRecord[] {
    const sess = this.bySession.get(sessionId);
    if (!sess) return [];
    const out: FileRecord[] = [];
    for (const id of fileIds) {
      const rec = sess.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  delete(sessionId: string, fileId: string): boolean {
    return this.bySession.get(sessionId)?.delete(fileId) ?? false;
  }

  clearSession(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}

function generateId(): string {
  return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const TEXT_LIKE_MIME_PATTERNS: RegExp[] = [
  /^text\//i,
  /^application\/json\b/i,
  /^application\/(?:x-)?yaml\b/i,
  /^application\/(?:xml|x-xml)\b/i,
  /^application\/(?:javascript|typescript|x-javascript|x-typescript)\b/i,
  /^application\/(?:csv)\b/i,
];

function looksLikeText(mimeType: string): boolean {
  return TEXT_LIKE_MIME_PATTERNS.some((re) => re.test(mimeType));
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Build the attachment context block to prepend to a user message. Text-like
 * files are included verbatim; binaries are surfaced as metadata only so the
 * model knows they exist but doesn't hallucinate contents.
 *
 * Returns an empty string if there are no attachments.
 */
export function buildAttachmentContext(records: FileRecord[]): string {
  if (records.length === 0) return '';
  const lines: string[] = ['[Attachments]'];
  for (const rec of records) {
    if (looksLikeText(rec.mimeType)) {
      const text = rec.bytes.toString('utf-8');
      lines.push(`- ${rec.name} (${rec.mimeType}, ${humanSize(rec.size)}):`);
      lines.push('"""');
      lines.push(text);
      lines.push('"""');
    } else {
      lines.push(
        `- ${rec.name} (${rec.mimeType}, ${humanSize(rec.size)}) — binary; no extraction tool wired. Tell the user if they expect you to read this.`,
      );
    }
  }
  return lines.join('\n');
}

export interface FileRouterOptions {
  store: InMemoryFileStore;
  maxUploadBytes: number;
}

export function createFilesRouter({ store, maxUploadBytes }: FileRouterOptions): Router {
  const router: Router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
  });

  router.post('/files', upload.single('file'), (req: Request, res: Response) => {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required (form field)' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file is required (multipart field "file")' });
      return;
    }
    const record: FileRecord = {
      id: generateId(),
      sessionId,
      name: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      bytes: file.buffer,
      createdAt: Date.now(),
    };
    store.put(record);
    const metadata: FileMetadata = {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
    };
    res.status(201).json({ item: metadata });
  });

  router.get('/files/:sessionId/:id', (req, res) => {
    const rec = store.get(req.params.sessionId, req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      item: {
        id: rec.id,
        name: rec.name,
        mimeType: rec.mimeType,
        size: rec.size,
      } satisfies FileMetadata,
    });
  });

  router.get('/files/:sessionId/:id/content', (req, res) => {
    const rec = store.get(req.params.sessionId, req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.setHeader('Content-Type', rec.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(rec.name)}"`);
    res.send(rec.bytes);
  });

  router.delete('/files/:sessionId/:id', (req, res) => {
    const removed = store.delete(req.params.sessionId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
