/**
 * A record type defines the shape and label of a class of records inside
 * an org. The store is intentionally generic: it does not enforce a field
 * schema. Hosts that want validation should layer it on top of
 * `customFields`. Type `key` is a stable host-chosen identifier (e.g.
 * `matter`, `asset`, `ticket`) and is unique per org.
 */
export interface RecordType {
    id: string;
    orgId: string;
    key: string;
    name: string;
    description: string;
    createdAt: number;
    updatedAt: number;
}

export interface CreateRecordTypeInput {
    orgId: string;
    key: string;
    name: string;
    description?: string;
}

export interface UpdateRecordTypeInput {
    name?: string;
    description?: string;
}

/**
 * Structured business record. `title` is the human-facing label the host
 * surfaces in lists and headers; `customFields` is opaque JSON that hosts
 * use for whatever schema they need. Stored as a JSON object — callers
 * should treat it as `Record<string, unknown>` and validate at their
 * boundary.
 */
export interface BusinessRecord {
    id: string;
    orgId: string;
    typeId: string;
    title: string;
    customFields: Record<string, unknown>;
    createdBy: string | null;
    createdAt: number;
    updatedAt: number;
    /** Non-null when archived. Archived rows are excluded from list reads unless `includeArchived` is set. */
    archivedAt: number | null;
}

export interface CreateRecordInput {
    orgId: string;
    typeId: string;
    title: string;
    customFields?: Record<string, unknown>;
    createdBy?: string | null;
}

/**
 * Patch input. `customFields` replaces the stored object when defined —
 * shallow-merge is not done at the store layer because it's lossy for
 * nested values; hosts that want merge semantics can read + spread + write.
 */
export interface UpdateRecordInput {
    title?: string;
    customFields?: Record<string, unknown>;
}

export interface ListRecordsOptions {
    orgId: string;
    /** Restrict to a single record type. Omit for org-wide. */
    typeId?: string;
    /** Case-insensitive substring match on `title`. */
    search?: string;
    /** Default false — exclude archived rows. */
    includeArchived?: boolean;
    /** Default 50. Capped at 500. */
    limit?: number;
    /** Default 0. */
    offset?: number;
    /** Default `updated_desc`. */
    order?: 'updated_desc' | 'created_desc' | 'title_asc';
}
