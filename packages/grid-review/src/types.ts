export type CellFormat =
    | 'text'
    | 'short_text'
    | 'date'
    | 'yes_no'
    | 'bullets'
    | 'money';

export type CellStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface Review {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface ReviewColumn {
    id: string;
    reviewId: string;
    title: string;
    prompt: string;
    format: CellFormat;
    position: number;
    createdAt: number;
    updatedAt: number;
}

export interface ReviewDocument {
    id: string;
    reviewId: string;
    /** Opaque pointer into the host's doc store (typically a workspace_documents.id). */
    externalDocId: string;
    name: string;
    mimeType: string | null;
    position: number;
    addedAt: number;
}

export interface ReviewCell {
    id: string;
    reviewId: string;
    columnId: string;
    reviewDocumentId: string;
    status: CellStatus;
    value: string | null;
    /** Raw JSON-encoded `Citation[]` from `@teamsuzie/citations`. Caller parses. */
    citations: string | null;
    error: string | null;
    updatedAt: number;
}

export interface ReviewSnapshot {
    review: Review;
    columns: ReviewColumn[];
    documents: ReviewDocument[];
    cells: ReviewCell[];
}

export interface CreateReviewInput {
    workspaceId: string;
    name: string;
    description?: string | null;
}

export interface UpdateReviewInput {
    name?: string;
    description?: string | null;
}

export interface AddColumnInput {
    reviewId: string;
    title: string;
    prompt: string;
    format?: CellFormat;
    position?: number;
}

export interface UpdateColumnInput {
    title?: string;
    prompt?: string;
    format?: CellFormat;
    position?: number;
}

export interface AddReviewDocumentInput {
    reviewId: string;
    externalDocId: string;
    name: string;
    mimeType?: string | null;
    position?: number;
}

export interface UpsertCellInput {
    reviewId: string;
    columnId: string;
    reviewDocumentId: string;
    status?: CellStatus;
    value?: string | null;
    /** JSON-stringified citations array. */
    citations?: string | null;
    error?: string | null;
}
