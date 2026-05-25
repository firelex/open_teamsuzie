import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Memory-cached file store with optional disk persistence so matter docs
 * (and other long-lived buckets) survive process restarts. When
 * `dataDir` is set, writes go through to disk and the store hydrates
 * from disk on construction; when null, the store is purely in-memory
 * (the original starter-external-agent behavior — fine for one-shot
 * chat sessions where files don't outlive the process).
 *
 * `sessionId` is the bucket key — for chat session uploads it's the
 * chat session id; for matter docs it's the matter id. The store
 * doesn't care about the semantics, only the namespacing.
 */

export interface FileRecord {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  bytes: Buffer;
  createdAt: number;
}

export interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface FileMetaSidecar {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

export interface InMemoryFileStoreOptions {
  /**
   * Directory to persist file bytes + metadata. Layout:
   *   <dataDir>/<encodeURIComponent(sessionId)>/<encodeURIComponent(id)>.bin
   *   <dataDir>/<encodeURIComponent(sessionId)>/<encodeURIComponent(id)>.meta.json
   *
   * `null` (or omitted) disables disk I/O — the store stays
   * in-memory and every write is lost on process exit. agent-runtime's
   * `startAgent` defaults this to `<dbPath dir>/files` so matter
   * uploads survive `tsx watch` reloads alongside the SQLite db.
   */
  dataDir?: string | null;
}

export class InMemoryFileStore {
  private bySession: Map<string, Map<string, FileRecord>> = new Map();
  private readonly dataDir: string | null;

  constructor(opts: InMemoryFileStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? null;
    if (this.dataDir) this.loadFromDisk(this.dataDir);
  }

  put(record: FileRecord): void {
    let sess = this.bySession.get(record.sessionId);
    if (!sess) {
      sess = new Map();
      this.bySession.set(record.sessionId, sess);
    }
    sess.set(record.id, record);
    if (this.dataDir) this.writeToDisk(this.dataDir, record);
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
    const removed = this.bySession.get(sessionId)?.delete(fileId) ?? false;
    if (removed && this.dataDir) {
      this.removeFromDisk(this.dataDir, sessionId, fileId);
    }
    return removed;
  }

  /** All files currently in a session, in insertion order. */
  listSession(sessionId: string): FileRecord[] {
    const sess = this.bySession.get(sessionId);
    if (!sess) return [];
    return Array.from(sess.values());
  }

  clearSession(sessionId: string): void {
    this.bySession.delete(sessionId);
    if (this.dataDir) this.removeBucketFromDisk(this.dataDir, sessionId);
  }

  /**
   * Re-key files from `fromSessionId` to `toSessionId`. Used by the
   * bare-route first-send flow: uploads land under a random tab session
   * id, then once a chat row is minted the files are promoted to the
   * chat id so the next chat-route lookup (which uses sessionId=chatId)
   * resolves them. Files not in `fileIds` are left under the original
   * session. Returns the new records (same ids, updated sessionId).
   */
  promote(
    fromSessionId: string,
    toSessionId: string,
    fileIds: string[],
  ): FileRecord[] {
    const fromSess = this.bySession.get(fromSessionId);
    if (!fromSess) return [];
    const out: FileRecord[] = [];
    for (const id of fileIds) {
      const rec = fromSess.get(id);
      if (!rec) continue;
      fromSess.delete(id);
      const next: FileRecord = { ...rec, sessionId: toSessionId };
      this.put(next);
      if (this.dataDir) {
        // The new bucket already has the bytes via `this.put(next)`
        // above; remove the now-orphaned old-bucket files from disk.
        this.removeFromDisk(this.dataDir, fromSessionId, id);
      }
      out.push(next);
    }
    if (fromSess.size === 0) {
      this.bySession.delete(fromSessionId);
      if (this.dataDir) this.removeBucketFromDisk(this.dataDir, fromSessionId);
    }
    return out;
  }

  // --- disk persistence ------------------------------------------------

  private loadFromDisk(dataDir: string): void {
    if (!existsSync(dataDir)) return;
    let buckets: string[];
    try {
      buckets = readdirSync(dataDir);
    } catch {
      return;
    }
    for (const bucketDir of buckets) {
      const bucketPath = path.join(dataDir, bucketDir);
      const sessionId = decodeURIComponent(bucketDir);
      let entries: string[];
      try {
        entries = readdirSync(bucketPath);
      } catch {
        continue;
      }
      const sess = new Map<string, FileRecord>();
      for (const entry of entries) {
        if (!entry.endsWith('.meta.json')) continue;
        const metaPath = path.join(bucketPath, entry);
        const dataPath = metaPath.replace(/\.meta\.json$/, '.bin');
        if (!existsSync(dataPath)) continue;
        try {
          const meta = JSON.parse(
            readFileSync(metaPath, 'utf8'),
          ) as FileMetaSidecar;
          const bytes = readFileSync(dataPath);
          sess.set(meta.id, { ...meta, bytes });
        } catch {
          // Skip corrupt sidecars; they'll be overwritten on next put.
        }
      }
      if (sess.size > 0) this.bySession.set(sessionId, sess);
    }
  }

  private writeToDisk(dataDir: string, record: FileRecord): void {
    const bucketPath = path.join(
      dataDir,
      encodeURIComponent(record.sessionId),
    );
    mkdirSync(bucketPath, { recursive: true });
    const safeId = encodeURIComponent(record.id);
    writeFileSync(path.join(bucketPath, `${safeId}.bin`), record.bytes);
    const meta: FileMetaSidecar = {
      id: record.id,
      sessionId: record.sessionId,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt,
    };
    writeFileSync(
      path.join(bucketPath, `${safeId}.meta.json`),
      JSON.stringify(meta),
    );
  }

  private removeFromDisk(
    dataDir: string,
    sessionId: string,
    fileId: string,
  ): void {
    const bucketPath = path.join(dataDir, encodeURIComponent(sessionId));
    const safeId = encodeURIComponent(fileId);
    rmSync(path.join(bucketPath, `${safeId}.bin`), { force: true });
    rmSync(path.join(bucketPath, `${safeId}.meta.json`), { force: true });
  }

  private removeBucketFromDisk(dataDir: string, sessionId: string): void {
    const bucketPath = path.join(dataDir, encodeURIComponent(sessionId));
    rmSync(bucketPath, { recursive: true, force: true });
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
 * Build the `[Attachments]` context block to prepend to a user message.
 * All files in the session are listed as metadata so the model knows
 * their file_ids across turns — otherwise the model loses sight of
 * earlier uploads after the first turn that mentions them. Text-like
 * files attached *this turn* additionally have their body inlined for
 * the model to read; binaries always render metadata-only (the agent
 * uses `convert_to_markdown` etc. to read them).
 *
 * `newAttachmentIds` is the set of ids the user attached in the
 * current turn — only those get their text body inlined (avoids
 * re-emitting long bodies every turn for previously-attached text).
 */
export function buildAttachmentContext(
  records: FileRecord[],
  newAttachmentIds?: ReadonlySet<string>,
): string {
  if (records.length === 0) return '';
  const lines: string[] = ['[Attachments]'];
  for (const rec of records) {
    const isNew = newAttachmentIds?.has(rec.id) ?? true;
    if (isNew && looksLikeText(rec.mimeType)) {
      const text = rec.bytes.toString('utf-8');
      lines.push(`- file_id=${rec.id} name=${rec.name} (${rec.mimeType}, ${humanSize(rec.size)}):`);
      lines.push('"""');
      lines.push(text);
      lines.push('"""');
    } else {
      lines.push(
        `- file_id=${rec.id} name=${rec.name} (${rec.mimeType}, ${humanSize(rec.size)}) — binary. Pass this file_id to convert_to_markdown to read it, or to propose_document_edits to redline (.docx only).`,
      );
    }
  }
  return lines.join('\n');
}

export interface FileRouterOptions {
  store: InMemoryFileStore;
  /** Per-file size cap. Default 25 MB. */
  maxUploadBytes?: number;
  /**
   * Optional document-versions store. When supplied, every successful
   * upload mints a `source:'upload'` row with `externalDocId = fileId`
   * and `storageId = fileId`. Subsequent proposal/accept/reject
   * versions chain off this row.
   */
  versionsStore?: {
    addVersion(input: {
      externalDocId: string;
      parentId?: string | null;
      source: 'upload';
      storageId: string;
      byteSize?: number | null;
      notes?: string | null;
    }): unknown;
  };
}

export function createFilesRouter({
  store,
  versionsStore,
  maxUploadBytes = 25 * 1024 * 1024,
}: FileRouterOptions): Router {
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
    if (versionsStore) {
      try {
        versionsStore.addVersion({
          externalDocId: record.id,
          parentId: null,
          source: 'upload',
          storageId: record.id,
          byteSize: record.size,
          notes: record.name,
        });
      } catch (err) {
        console.warn(
          '[files-route] versionsStore.addVersion failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    const metadata: FileMetadata = {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
    };
    res.status(201).json({ item: metadata });
  });

  /**
   * Re-key uploaded files from one session to another. The chat UI's
   * bare-route first send uploads under a random `tabSessionId`, then
   * after minting a chat row calls this to promote the files to the
   * chat id so the subsequent chat-route lookup (which uses
   * sessionId=chatId) resolves them.
   */
  router.post('/files/promote', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fromSessionId = String(body.fromSessionId ?? '').trim();
    const toSessionId = String(body.toSessionId ?? '').trim();
    const fileIds = Array.isArray(body.fileIds)
      ? (body.fileIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];
    if (!fromSessionId || !toSessionId) {
      res.status(400).json({ error: 'fromSessionId and toSessionId are required' });
      return;
    }
    if (fileIds.length === 0) {
      res.status(400).json({ error: 'fileIds must be a non-empty array' });
      return;
    }
    const promoted = store.promote(fromSessionId, toSessionId, fileIds);
    const items: FileMetadata[] = promoted.map((rec) => ({
      id: rec.id,
      name: rec.name,
      mimeType: rec.mimeType,
      size: rec.size,
    }));
    res.json({ items });
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
