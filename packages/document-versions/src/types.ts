/**
 * What kind of operation produced this version. The host app uses this to
 * label versions in the UI ("uploaded", "redline proposal", "accepted") and
 * to drive flow-specific behaviour (e.g. only `proposal` versions need
 * accept/reject; `upload` and resolution outputs are terminal; `generated`
 * versions come from `generate_docx`-style synthesis with no parent).
 */
export type VersionSource =
    | 'upload'
    | 'proposal'
    | 'accept'
    | 'reject'
    | 'generated';

export const VERSION_SOURCES: readonly VersionSource[] = [
    'upload',
    'proposal',
    'accept',
    'reject',
    'generated',
] as const;

export interface DocumentVersion {
    id: string;
    /**
     * Opaque id identifying the logical document this version belongs to.
     * No FK across packages — same loose-coupling pattern as
     * `chats.workspace_id` and `review_documents.external_doc_id`.
     */
    externalDocId: string;
    /** Parent version id; null for the root upload. */
    parentId: string | null;
    source: VersionSource;
    /**
     * Opaque pointer the host uses to retrieve the version's bytes (e.g. a
     * file_id in suzielaw's `InMemoryFileStore`). The store doesn't read
     * or interpret this value.
     */
    storageId: string;
    byteSize: number | null;
    /** SHA-256 hex of the bytes, when computed. Useful for dedup and audit. */
    contentHash: string | null;
    /** Optional human-readable label / source author / commit message. */
    notes: string | null;
    createdAt: number;
}

export interface AddVersionInput {
    externalDocId: string;
    parentId?: string | null;
    source: VersionSource;
    storageId: string;
    byteSize?: number | null;
    contentHash?: string | null;
    notes?: string | null;
}
