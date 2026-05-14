import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { convertToMarkdown } from '@teamsuzie/document-conversion';
import type { KnowledgeBaseStore } from './store.js';
import type { KbSearchHit } from './types.js';

interface IndexRow {
    workspace_id: string;
    file_id: string;
    kb_doc_id: string;
    indexed_at: number;
}

/**
 * Minimal document record shape WorkspaceRag needs to ingest a file.
 * Callers (e.g. an `InMemoryFileStore`) typically have a richer record;
 * pass the subset that matches this shape.
 */
export interface WorkspaceDocRecord {
    /** Stable id, used as the (workspace_id, file_id) mapping key. */
    id: string;
    /** Human-readable display name (also passed to the KB row). */
    name: string;
    /** MIME type — drives DOCX-vs-markitdown routing in convertToMarkdown. */
    mimeType: string;
    /** Byte length for KB metadata. */
    size: number;
    /** File bytes to convert + index. */
    bytes: Buffer | Uint8Array;
}

export interface WorkspaceRagOptions {
    db: DatabaseInstance;
    kb: KnowledgeBaseStore;
    markitdownBaseUrl: string;
}

/**
 * Per-workspace RAG glue. Indexes uploaded workspace docs into the shared
 * `KnowledgeBaseStore` with `ownerId = workspace:<workspaceId>` and tracks
 * the (workspace_id, file_id) → kb_doc_id mapping in the
 * `workspace_doc_index` table.
 *
 * Cell runs (and later workspace chats) call `searchInDoc` /
 * `searchInWorkspace` to retrieve top-K relevant chunks instead of feeding
 * full document text into the prompt.
 *
 * Callers are responsible for provisioning the `workspace_doc_index` table:
 *
 *     CREATE TABLE IF NOT EXISTS workspace_doc_index (
 *       workspace_id TEXT NOT NULL,
 *       file_id      TEXT NOT NULL,
 *       kb_doc_id    TEXT NOT NULL,
 *       indexed_at   INTEGER NOT NULL,
 *       PRIMARY KEY (workspace_id, file_id)
 *     );
 */
export class WorkspaceRag {
    private readonly db: DatabaseInstance;
    private readonly kb: KnowledgeBaseStore;
    private readonly markitdownBaseUrl: string;

    constructor(opts: WorkspaceRagOptions) {
        this.db = opts.db;
        this.kb = opts.kb;
        this.markitdownBaseUrl = opts.markitdownBaseUrl;
    }

    /**
     * Convert a freshly-uploaded file into markdown and insert it into the
     * KB scoped to the workspace. Records the (workspace, file) → kb-doc
     * mapping so subsequent searches can target this doc.
     *
     * Idempotent: re-indexing the same (workspace, file) drops the prior KB
     * entry first, so the latest call wins.
     *
     * Returns `{ ok: true, chunkCount }` on success and `{ ok: false, reason }`
     * when conversion fails or yields nothing — callers can surface either
     * outcome in their logs.
     */
    async indexFile(
        workspaceId: string,
        record: WorkspaceDocRecord,
    ): Promise<
        | { ok: true; kbDocId: string; chunkCount: number }
        | { ok: false; reason: string }
    > {
        // If this (workspace, file) was indexed before, drop the prior KB
        // doc and the mapping so we don't end up with stale chunks.
        const prior = this.lookupKbDocId(workspaceId, record.id);
        if (prior) {
            try {
                this.kb.delete(prior);
            } catch {
                /* noop — best-effort cleanup */
            }
            this.deleteMapping(workspaceId, record.id);
        }

        let markdown: string;
        try {
            const result = await convertToMarkdown(record.bytes, {
                mime: record.mimeType,
                filename: record.name,
                markitdownAgentBaseUrl: this.markitdownBaseUrl,
            });
            markdown = result.markdown;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                ok: false,
                reason: `convert failed: ${message}`,
            };
        }
        if (!markdown.trim()) {
            return { ok: false, reason: 'converted to empty markdown' };
        }

        const inserted = await this.kb.insert({
            name: record.name,
            mimeType: record.mimeType,
            size: record.size,
            markdown,
            ownerId: ownerIdForWorkspace(workspaceId),
        });

        this.recordMapping(workspaceId, record.id, inserted.id);
        return {
            ok: true,
            kbDocId: inserted.id,
            chunkCount: inserted.chunkCount,
        };
    }

    /** Drop a file's KB index + mapping, e.g. when a workspace doc is removed. */
    removeFile(workspaceId: string, fileId: string): void {
        const kbDocId = this.lookupKbDocId(workspaceId, fileId);
        if (!kbDocId) return;
        // Snapshot name + chunk count before delete so the success log can
        // report what came out, mirroring the upload path's "indexed X →
        // N chunk(s)" line.
        const docBefore = this.kb.get(kbDocId);
        const startedAt = Date.now();
        let kbDeleteOk = true;
        try {
            this.kb.delete(kbDocId);
        } catch (err) {
            // If the kb-side delete fails we leave the workspace_doc_index
            // row in place so a future retry / sweep can find the orphan
            // again. Logging is critical here — the previous silent swallow
            // caused the FTS-trigger bug to manifest as orphaned chunks
            // days later.
            kbDeleteOk = false;
            console.warn(
                `[workspace-rag] kb.delete(${kbDocId}) failed for (${workspaceId}, ${fileId}):`,
                err instanceof Error ? err.message : err,
            );
        }
        if (kbDeleteOk) {
            this.deleteMapping(workspaceId, fileId);
            const elapsed = Date.now() - startedAt;
            const name = docBefore?.name ?? fileId;
            const chunks = docBefore?.chunkCount ?? 0;
            console.log(
                `[workspace-rag] removed ${name} → ${chunks} chunk(s) dropped in ${elapsed}ms`,
            );
        }
    }

    /** Drop everything indexed for a workspace — call when the workspace is deleted. */
    removeWorkspace(workspaceId: string): void {
        const ids = prepareCached<[string], { kb_doc_id: string }>(
            this.db,
            `SELECT kb_doc_id FROM workspace_doc_index WHERE workspace_id = ?`,
        )
            .all(workspaceId)
            .map((r) => r.kb_doc_id);
        const stillOrphaned: string[] = [];
        for (const id of ids) {
            try {
                this.kb.delete(id);
            } catch (err) {
                stillOrphaned.push(id);
                console.warn(
                    `[workspace-rag] kb.delete(${id}) failed during removeWorkspace(${workspaceId}):`,
                    err instanceof Error ? err.message : err,
                );
            }
        }
        // Only drop mappings whose kb_documents row is actually gone — keeps
        // partial-failure state recoverable on the next call.
        if (stillOrphaned.length === 0) {
            prepareCached<[string]>(
                this.db,
                `DELETE FROM workspace_doc_index WHERE workspace_id = ?`,
            ).run(workspaceId);
        } else {
            const placeholders = stillOrphaned.map(() => '?').join(',');
            this.db
                .prepare(
                    `DELETE FROM workspace_doc_index
                       WHERE workspace_id = ?
                         AND kb_doc_id NOT IN (${placeholders})`,
                )
                .run(workspaceId, ...stillOrphaned);
        }
    }

    /**
     * Top-K chunks across the workspace — used by future workspace-chat to
     * feed a `vector_search` tool. Excludes mappings whose KB doc has since
     * been deleted. Uses hybrid (vector + BM25) retrieval.
     */
    async searchInWorkspace(
        workspaceId: string,
        query: string,
        topK = 5,
    ): Promise<KbSearchHit[]> {
        return this.kb.searchHybrid(query, {
            ownerId: ownerIdForWorkspace(workspaceId),
            topK,
        });
    }

    /**
     * Top-K chunks scoped to a single workspace document (cell runner path).
     * Hybrid retrieval — keyword matches catch literal phrases like
     * "governing law" that pure embeddings can rank under unrelated
     * "law"-adjacent text; vector matches catch paraphrases the keyword
     * lane misses. Reciprocal Rank Fusion combines them.
     */
    async searchInDoc(
        workspaceId: string,
        fileId: string,
        query: string,
        topK = 5,
    ): Promise<KbSearchHit[]> {
        const kbDocId = this.lookupKbDocId(workspaceId, fileId);
        if (!kbDocId) return [];
        return this.kb.searchHybrid(query, {
            ownerId: ownerIdForWorkspace(workspaceId),
            documentIds: [kbDocId],
            topK,
        });
    }

    /** Whether a (workspace, file) pair has a KB index ready. */
    hasIndex(workspaceId: string, fileId: string): boolean {
        return this.lookupKbDocId(workspaceId, fileId) !== null;
    }

    // --- private ---------------------------------------------------------

    private lookupKbDocId(workspaceId: string, fileId: string): string | null {
        const row = prepareCached<[string, string], IndexRow>(
            this.db,
            `SELECT * FROM workspace_doc_index WHERE workspace_id = ? AND file_id = ?`,
        ).get(workspaceId, fileId);
        return row?.kb_doc_id ?? null;
    }

    private recordMapping(workspaceId: string, fileId: string, kbDocId: string): void {
        prepareCached<[string, string, string, number]>(
            this.db,
            `INSERT INTO workspace_doc_index (workspace_id, file_id, kb_doc_id, indexed_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(workspace_id, file_id) DO UPDATE SET
               kb_doc_id = excluded.kb_doc_id,
               indexed_at = excluded.indexed_at`,
        ).run(workspaceId, fileId, kbDocId, Date.now());
    }

    private deleteMapping(workspaceId: string, fileId: string): void {
        prepareCached<[string, string]>(
            this.db,
            `DELETE FROM workspace_doc_index WHERE workspace_id = ? AND file_id = ?`,
        ).run(workspaceId, fileId);
    }
}

function ownerIdForWorkspace(workspaceId: string): string {
    return `workspace:${workspaceId}`;
}
