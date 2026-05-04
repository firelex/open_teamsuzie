/**
 * A document indexed into the knowledge base. Originals aren't stored — only
 * the markdown text + chunks + embeddings. Re-upload to refresh.
 */
export interface KbDocument {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes of the original upload, for display only — not retrievable. */
  size: number;
  /** Total chunk count for this document. */
  chunkCount: number;
  /** Optional owner id (e.g. user email). The store doesn't enforce
   *  ownership — callers do. Leave null for a single-tenant KB. */
  ownerId: string | null;
  createdAt: number;
}

export interface KbChunk {
  id: number;
  documentId: string;
  chunkIndex: number;
  /** Plain-text chunk content (markdown is fine). */
  content: string;
  /** Character offsets into the source markdown. Useful for rebuilding the
   *  surrounding context when displaying a hit. */
  startChar: number;
  endChar: number;
}

export interface KbSearchHit {
  /** The matched chunk. */
  chunk: KbChunk;
  /** The chunk's parent document. */
  document: KbDocument;
  /**
   * Cosine distance — lower is more similar (sqlite-vec convention). Omitted
   * for keyword-only hits that didn't pass through the vector index, e.g.
   * the FTS5 side of a hybrid search where a chunk only matched on
   * keywords. Hybrid hits keep the vector distance when both lanes hit
   * the same chunk.
   */
  distance?: number;
}

export interface KbInsertInput {
  /** Document display name (e.g. filename). */
  name: string;
  /** Mime type of the original. */
  mimeType: string;
  /** Original byte size — informational only. */
  size: number;
  /** Already-converted markdown text. Caller is responsible for converting
   *  binaries (DOCX/PDF/etc.) to markdown before insert. */
  markdown: string;
  /** Caller-supplied owner id, if any. */
  ownerId?: string;
}
