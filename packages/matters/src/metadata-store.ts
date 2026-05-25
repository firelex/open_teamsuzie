import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

/**
 * Sidecar table for matter type + custom-field values. One row per
 * matter; existence is optional (a freshly-created matter has no row
 * until the host writes type / custom fields).
 *
 * `matter_id` references `workspaces.id` with ON DELETE CASCADE so a
 * matter delete drops its metadata for free. Cross-package FK works
 * because both packages migrate against the same SQLite database and
 * `PRAGMA foreign_keys = ON` is set by `@teamsuzie/db-sqlite`'s default
 * pragmas.
 *
 * `custom_fields_json` stores the values blob as a JSON object keyed by
 * the manifest's custom-field `key`. Schema-on-read — the package keeps
 * out of validation (that lives in agent-runtime's
 * `validateCustomFieldValues` against the manifest's field config).
 */
export const MATTERS_METADATA_MIGRATIONS: Migration[] = [
    {
        name: '20260525_create_matter_metadata',
        up: `
            CREATE TABLE IF NOT EXISTS matter_metadata (
                matter_id           TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
                type_id             TEXT,
                custom_fields_json  TEXT NOT NULL DEFAULT '{}',
                created_at          INTEGER NOT NULL,
                updated_at          INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_matter_metadata_type
                ON matter_metadata(type_id);
        `,
    },
];

export interface MatterMetadata {
    matterId: string;
    typeId: string | null;
    customFields: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

interface MatterMetadataRow {
    matter_id: string;
    type_id: string | null;
    custom_fields_json: string;
    created_at: number;
    updated_at: number;
}

export interface UpsertMatterMetadataInput {
    matterId: string;
    typeId: string | null;
    customFields: Record<string, unknown>;
}

export interface MatterMetadataStoreOptions {
    db: DatabaseInstance;
    now?: () => number;
}

function rowToMetadata(row: MatterMetadataRow): MatterMetadata {
    let customFields: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(row.custom_fields_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            customFields = parsed as Record<string, unknown>;
        }
    } catch {
        // Treat malformed JSON as empty — never throw on read.
    }
    return {
        matterId: row.matter_id,
        typeId: row.type_id,
        customFields,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * CRUD over the `matter_metadata` table. Read paths are null-safe (a
 * matter with no metadata row reads as null, not an error); write paths
 * are upsert-style so the host doesn't need to know whether the row
 * already exists.
 */
export class MatterMetadataStore {
    private readonly db: DatabaseInstance;
    private readonly clock: () => number;

    constructor(opts: MatterMetadataStoreOptions) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => Date.now());
    }

    get(matterId: string): MatterMetadata | null {
        const row = prepareCached<[string], MatterMetadataRow>(
            this.db,
            `SELECT * FROM matter_metadata WHERE matter_id = ?`,
        ).get(matterId);
        return row ? rowToMetadata(row) : null;
    }

    /**
     * Insert on first call, replace `type_id` + `custom_fields_json` on
     * subsequent calls. `created_at` survives updates so the row's
     * provenance stays intact; `updated_at` always advances.
     */
    upsert(input: UpsertMatterMetadataInput): MatterMetadata {
        const now = this.clock();
        const json = JSON.stringify(input.customFields ?? {});
        prepareCached<
            [string, string | null, string, number, number]
        >(
            this.db,
            `INSERT INTO matter_metadata
               (matter_id, type_id, custom_fields_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(matter_id) DO UPDATE SET
               type_id = excluded.type_id,
               custom_fields_json = excluded.custom_fields_json,
               updated_at = excluded.updated_at`,
        ).run(input.matterId, input.typeId, json, now, now);
        return this.get(input.matterId)!;
    }

    /**
     * Matter ids whose stored type_id matches `typeId`. Used by the
     * type-grouped sidebar so the host can render section headers
     * without scanning every metadata row in memory.
     */
    listByType(typeId: string): string[] {
        return prepareCached<[string], { matter_id: string }>(
            this.db,
            `SELECT matter_id FROM matter_metadata
              WHERE type_id = ?
              ORDER BY updated_at DESC`,
        )
            .all(typeId)
            .map((r) => r.matter_id);
    }

    /**
     * Remove a metadata row. Returns false when no row was deleted —
     * useful when the host wants to know whether something actually
     * existed. The ON DELETE CASCADE from workspaces handles the
     * matter-delete path for free; this method is for explicit clears.
     */
    delete(matterId: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM matter_metadata WHERE matter_id = ?`,
        ).run(matterId);
        return result.changes > 0;
    }
}
