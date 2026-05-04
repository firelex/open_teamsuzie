import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
    AddVersionInput,
    DocumentVersion,
    VersionSource,
} from './types.js';
import { VERSION_SOURCES } from './types.js';

interface VersionRow {
    id: string;
    external_doc_id: string;
    parent_id: string | null;
    source: string;
    storage_id: string;
    byte_size: number | null;
    content_hash: string | null;
    notes: string | null;
    created_at: number;
}

interface HeadRow {
    external_doc_id: string;
    current_version_id: string;
    updated_at: number;
}

export interface DocumentVersionsStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

/**
 * CRUD over `document_versions` + `document_heads`. Adding a version
 * always re-points the head at the new version (the typical case — the
 * caller built it by deriving from the prior head). Use `setHead` to
 * restore an older version without writing a new one.
 */
export class DocumentVersionsStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: DocumentVersionsStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    addVersion(input: AddVersionInput): DocumentVersion {
        if (!VERSION_SOURCES.includes(input.source)) {
            throw new Error(
                `invalid source: ${input.source} (expected one of: ${VERSION_SOURCES.join(', ')})`,
            );
        }
        if (input.parentId) {
            const parent = this.getVersion(input.parentId);
            if (!parent) {
                throw new Error(`parentId not found: ${input.parentId}`);
            }
            if (parent.externalDocId !== input.externalDocId) {
                throw new Error(
                    `parentId ${input.parentId} belongs to a different document`,
                );
            }
        }
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [
                string,
                string,
                string | null,
                string,
                string,
                number | null,
                string | null,
                string | null,
                number,
            ]
        >(
            this.db,
            `INSERT INTO document_versions (id, external_doc_id, parent_id, source, storage_id, byte_size, content_hash, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.externalDocId,
            input.parentId ?? null,
            input.source,
            input.storageId,
            input.byteSize ?? null,
            input.contentHash ?? null,
            input.notes ?? null,
            now,
        );
        // New version becomes the head.
        prepareCached<[string, string, number]>(
            this.db,
            `INSERT INTO document_heads (external_doc_id, current_version_id, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(external_doc_id) DO UPDATE SET
                 current_version_id = excluded.current_version_id,
                 updated_at = excluded.updated_at`,
        ).run(input.externalDocId, id, now);
        return this.getVersion(id)!;
    }

    getVersion(id: string): DocumentVersion | null {
        const row = prepareCached<[string], VersionRow>(
            this.db,
            `SELECT * FROM document_versions WHERE id = ?`,
        ).get(id);
        return row ? rowToVersion(row) : null;
    }

    /** Versions for one logical document, oldest first. */
    listVersions(externalDocId: string): DocumentVersion[] {
        return prepareCached<[string], VersionRow>(
            this.db,
            `SELECT * FROM document_versions
             WHERE external_doc_id = ?
             ORDER BY created_at ASC, id ASC`,
        )
            .all(externalDocId)
            .map(rowToVersion);
    }

    getHead(externalDocId: string): DocumentVersion | null {
        const headRow = prepareCached<[string], HeadRow>(
            this.db,
            `SELECT * FROM document_heads WHERE external_doc_id = ?`,
        ).get(externalDocId);
        if (!headRow) return null;
        return this.getVersion(headRow.current_version_id);
    }

    /**
     * Restore-an-old-version: re-point the head at any existing version
     * for this document. The version chain itself is preserved.
     */
    setHead(externalDocId: string, versionId: string): DocumentVersion {
        const version = this.getVersion(versionId);
        if (!version) {
            throw new Error(`version not found: ${versionId}`);
        }
        if (version.externalDocId !== externalDocId) {
            throw new Error(
                `version ${versionId} belongs to a different document`,
            );
        }
        const now = this.clock();
        prepareCached<[string, string, number]>(
            this.db,
            `INSERT INTO document_heads (external_doc_id, current_version_id, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(external_doc_id) DO UPDATE SET
                 current_version_id = excluded.current_version_id,
                 updated_at = excluded.updated_at`,
        ).run(externalDocId, versionId, now);
        return version;
    }

    /**
     * Walk back from a version through `parent_id` pointers to the root.
     * Returns the version itself first, then its parent, then the
     * grandparent, etc. Cycle-safe: bails out if a parent_id has already
     * been visited (shouldn't happen in well-formed data, but inserting
     * via SQL bypasses our application-level checks).
     */
    walkAncestors(versionId: string): DocumentVersion[] {
        const out: DocumentVersion[] = [];
        const seen = new Set<string>();
        let cursor: string | null = versionId;
        while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            const v = this.getVersion(cursor);
            if (!v) break;
            out.push(v);
            cursor = v.parentId;
        }
        return out;
    }

    /**
     * All versions whose parent chain leads back to `versionId` (excluding
     * `versionId` itself). For branch-aware UIs that show "since you
     * branched at v3, these are the versions on that branch".
     */
    walkDescendants(versionId: string): DocumentVersion[] {
        const all = prepareCached<[string], VersionRow>(
            this.db,
            `SELECT * FROM document_versions
             WHERE external_doc_id = (
                 SELECT external_doc_id FROM document_versions WHERE id = ?
             )
             ORDER BY created_at ASC`,
        )
            .all(versionId)
            .map(rowToVersion);
        const byParent = new Map<string | null, DocumentVersion[]>();
        for (const v of all) {
            const list = byParent.get(v.parentId) ?? [];
            list.push(v);
            byParent.set(v.parentId, list);
        }
        const out: DocumentVersion[] = [];
        const visit = (parent: string) => {
            const children = byParent.get(parent) ?? [];
            for (const c of children) {
                out.push(c);
                visit(c.id);
            }
        };
        visit(versionId);
        return out;
    }

    /**
     * Cascade-delete every version and the head pointer for a logical
     * document. Use when the host removes the document entirely. Versions
     * referencing each other across the chain are removed transactionally
     * so foreign-key constraints don't trip on deletion order.
     */
    deleteAllForDocument(externalDocId: string): number {
        const tx = this.db.transaction(() => {
            prepareCached<[string]>(
                this.db,
                `DELETE FROM document_heads WHERE external_doc_id = ?`,
            ).run(externalDocId);
            // Children-first deletion to satisfy parent_id FK.
            const versions = this.listVersions(externalDocId);
            for (const v of [...versions].reverse()) {
                prepareCached<[string]>(
                    this.db,
                    `DELETE FROM document_versions WHERE id = ?`,
                ).run(v.id);
            }
            return versions.length;
        });
        return tx();
    }
}

function rowToVersion(row: VersionRow): DocumentVersion {
    return {
        id: row.id,
        externalDocId: row.external_doc_id,
        parentId: row.parent_id,
        source: row.source as VersionSource,
        storageId: row.storage_id,
        byteSize: row.byte_size,
        contentHash: row.content_hash,
        notes: row.notes,
        createdAt: row.created_at,
    };
}
