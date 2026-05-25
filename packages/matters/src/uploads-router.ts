import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { WorkspacesStore } from '@teamsuzie/workspaces';
import type { DocumentVersionsStore } from '@teamsuzie/document-versions';

/**
 * Minimal file-record shape the matter-uploads router needs. Mirrors the
 * upstream `InMemoryFileStore` record in agent-runtime so the runtime's
 * file store can be passed in directly without an adapter, but kept here
 * as a local interface so this package doesn't have to depend on
 * agent-runtime (which would invert the wiring direction).
 */
export interface MatterFileRecord {
    id: string;
    /** Bucket key. For matter uploads this is the matter id. */
    sessionId: string;
    name: string;
    mimeType: string;
    size: number;
    bytes: Buffer;
    createdAt: number;
}

/**
 * Minimum surface the matter-uploads router needs from a file store. The
 * agent-runtime's `InMemoryFileStore` satisfies this structurally; tests
 * can supply a fake.
 */
export interface MatterFileStore {
    put(record: MatterFileRecord): void;
    get(sessionId: string, fileId: string): MatterFileRecord | undefined;
}

export interface CreateMatterUploadsRouterOptions {
    fileStore: MatterFileStore;
    workspaces: WorkspacesStore;
    maxUploadBytes: number;
    /**
     * Optional version-chain hookup. When set, every uploaded matter doc
     * records a `source: 'upload'` row as the root of the doc's version
     * chain so later proposals can branch from a known starting point.
     * Failures are logged and swallowed — the upload still succeeds.
     */
    documentVersions?: DocumentVersionsStore;
}

const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
    '.csv',
    '.docx',
    '.epub',
    '.htm',
    '.html',
    '.json',
    '.md',
    '.markdown',
    '.pdf',
    '.pptx',
    '.txt',
    '.xlsx',
]);

function validateSupportedUpload(file: Express.Multer.File): string | null {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (SUPPORTED_UPLOAD_EXTENSIONS.has(ext)) return null;
    return `Unsupported file type${ext ? ` "${ext}"` : ''}. Upload PDF, DOCX, PPTX, XLSX, HTML, EPUB, Markdown, text, CSV, or JSON.`;
}

function generateId(): string {
    return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Bridges multipart upload → matter file bucket → `workspace_documents`
 * row → optional version-chain root. The download URL is whatever the
 * host's files router serves for `bucket=<matterId>` — matter docs share
 * the same plumbing as chat-session uploads, just under a different
 * bucket key.
 *
 * Mount under `/api/matters`:
 *
 *   POST /:matterId/documents/upload   multipart `file`, optional `folderId`
 */
export function createMatterUploadsRouter(
    opts: CreateMatterUploadsRouterOptions,
): Router {
    const { fileStore, workspaces, maxUploadBytes, documentVersions } = opts;
    const router: Router = Router();
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxUploadBytes },
    });

    router.post(
        '/:matterId/documents/upload',
        upload.single('file'),
        (req, res) => {
            const matterId = String(req.params.matterId ?? '');
            if (!workspaces.getWorkspace(matterId)) {
                res.status(404).json({ error: 'matter not found' });
                return;
            }
            const file = req.file;
            if (!file) {
                res.status(400).json({
                    error: 'file is required (multipart field "file")',
                });
                return;
            }
            const unsupportedReason = validateSupportedUpload(file);
            if (unsupportedReason) {
                res.status(415).json({ error: unsupportedReason });
                return;
            }
            const folderInput = req.body?.folderId;
            const folderId =
                typeof folderInput === 'string' && folderInput.length > 0
                    ? folderInput
                    : null;

            const fileId = generateId();
            const record: MatterFileRecord = {
                id: fileId,
                sessionId: matterId,
                name: file.originalname,
                mimeType: file.mimetype || 'application/octet-stream',
                size: file.size,
                bytes: file.buffer,
                createdAt: Date.now(),
            };
            fileStore.put(record);

            const doc = workspaces.addDocument({
                workspaceId: matterId,
                folderId,
                externalDocId: fileId,
                name: record.name,
                mimeType: record.mimeType,
                size: record.size,
            });

            if (documentVersions) {
                try {
                    documentVersions.addVersion({
                        externalDocId: fileId,
                        source: 'upload',
                        storageId: fileId,
                        byteSize: record.size,
                        notes: record.name,
                    });
                } catch (err) {
                    console.warn(
                        `[matters] addVersion(upload) failed for ${record.name}:`,
                        err instanceof Error ? err.message : err,
                    );
                }
            }

            res.status(201).json({ item: doc });
        },
    );

    return router;
}
