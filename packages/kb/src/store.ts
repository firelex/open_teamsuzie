import * as sqliteVec from 'sqlite-vec';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { chunkMarkdown, type ChunkerOptions } from './chunker.js';
import type { Embedder } from './embedder.js';
import type { KbChunk, KbDocument, KbInsertInput, KbSearchHit } from './types.js';

export interface KnowledgeBaseStoreOptions {
  db: DatabaseInstance;
  embedder: Embedder;
  /** Override chunker defaults. */
  chunker?: ChunkerOptions;
  /** Disable extension loading (useful for tests where the extension is
   *  loaded externally). Defaults to false. */
  skipExtensionLoad?: boolean;
}

/**
 * Lightweight RAG store. Loads the sqlite-vec extension at construction
 * time, ensures the vec0 virtual table exists for the configured embedding
 * dimension, and provides ingest / list / get / delete / search.
 *
 * Single-tenant by default. Pass `ownerId` on insert + filter on
 * `listByOwner` if you need per-user scoping.
 */
export class KnowledgeBaseStore {
  private readonly db: DatabaseInstance;
  private readonly embedder: Embedder;
  private readonly chunkerOptions: ChunkerOptions | undefined;

  constructor(opts: KnowledgeBaseStoreOptions) {
    this.db = opts.db;
    this.embedder = opts.embedder;
    this.chunkerOptions = opts.chunker;

    if (!opts.skipExtensionLoad) {
      sqliteVec.load(this.db);
    }
    // Idempotent: virtual tables are created once and survive restarts.
    // - vec0: dense embeddings for semantic search.
    // - fts5: keyword search for hybrid retrieval. External-content table
    //   keyed on kb_chunks.id so we don't duplicate chunk text on disk;
    //   the porter stemmer + unicode61 tokenizer give reasonable English
    //   matching out of the box.
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunk_vectors USING vec0(
        rowid INTEGER PRIMARY KEY,
        embedding float[${opts.embedder.dim}]
      );
    `);
    this.ensureFtsTable();
  }

  /**
   * (Re)create kb_chunks_fts as a *managed* FTS5 table — i.e. one that
   * stores the indexed content itself. Managed tables accept plain
   * INSERT / DELETE (no triggers, no special-form 'delete' commands),
   * which makes inserts/deletes from store.insert / store.delete just
   * work without subtle pitfalls.
   *
   * We drop + recreate on every startup. Cost is bounded by total chunk
   * text size and is typically milliseconds — imperceptible for legal-doc
   * KBs. The upside is that any prior schema (external-content tables
   * with stale triggers, corrupt index pages from earlier bad writes,
   * etc.) is migrated cleanly without a manual recovery step.
   *
   * The legacy triggers from the external-content era are dropped first
   * — leaving them around against a managed table would silently
   * double-write on inserts and crash on deletes.
   */
  private ensureFtsTable(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS kb_chunks_ai;
      DROP TRIGGER IF EXISTS kb_chunks_ad;
      DROP TRIGGER IF EXISTS kb_chunks_au;
      DROP TABLE IF EXISTS kb_chunks_fts;
      CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
        content,
        tokenize='porter unicode61'
      );
      INSERT INTO kb_chunks_fts (rowid, content)
        SELECT id, content FROM kb_chunks;
    `);
    const chunkCount =
      prepareCached<[], { n: number }>(this.db, `SELECT COUNT(*) AS n FROM kb_chunks`).get()?.n ?? 0;
    const ftsCount =
      prepareCached<[], { n: number }>(this.db, `SELECT COUNT(*) AS n FROM kb_chunks_fts`).get()?.n ?? 0;
    if (chunkCount > 0) {
      console.log(`[kb] kb_chunks_fts ready: ${ftsCount}/${chunkCount} row(s)`);
    }
  }

  async insert(input: KbInsertInput): Promise<KbDocument> {
    const id = generateId();
    const now = Date.now();
    const chunks = chunkMarkdown(input.markdown, this.chunkerOptions);
    if (chunks.length === 0) {
      throw new Error('Cannot insert empty document — chunker produced 0 chunks');
    }

    // Embed up-front so a failure leaves nothing partially inserted.
    const vectors = await this.embedder.embed(chunks.map((c) => c.content));

    const insertDoc = prepareCached<[string, string, string, number, string, number, string | null, number]>(
      this.db,
      `INSERT INTO kb_documents (id, name, mime_type, size, markdown, chunk_count, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertChunk = prepareCached<[string, number, string, number, number, number]>(
      this.db,
      `INSERT INTO kb_chunks (document_id, chunk_index, content, start_char, end_char, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertVec = prepareCached<[bigint, Float32Array]>(
      this.db,
      `INSERT INTO kb_chunk_vectors (rowid, embedding) VALUES (?, ?)`,
    );
    const insertFts = prepareCached<[bigint, string]>(
      this.db,
      `INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)`,
    );

    const tx = this.db.transaction(() => {
      insertDoc.run(
        id,
        input.name,
        input.mimeType,
        input.size,
        input.markdown,
        chunks.length,
        input.ownerId ?? null,
        now,
      );
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const result = insertChunk.run(id, i, c.content, c.startChar, c.endChar, now);
        // sqlite-vec's vec0 virtual table is strict: rowid must be BigInt,
        // embedding must be a Float32Array (or compatible binary blob).
        const rowId = BigInt(result.lastInsertRowid);
        insertVec.run(rowId, Float32Array.from(vectors[i]));
        insertFts.run(rowId, c.content);
      }
    });
    tx();

    return {
      id,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      chunkCount: chunks.length,
      ownerId: input.ownerId ?? null,
      createdAt: now,
    };
  }

  list(ownerId: string | null): KbDocument[] {
    const rows = ownerId
      ? prepareCached<[string], DocRow>(
          this.db,
          `SELECT * FROM kb_documents WHERE owner_id = ? ORDER BY created_at DESC`,
        ).all(ownerId)
      : prepareCached<[], DocRow>(
          this.db,
          `SELECT * FROM kb_documents ORDER BY created_at DESC`,
        ).all();
    return rows.map(rowToDoc);
  }

  get(id: string): KbDocument | null {
    const row = prepareCached<[string], DocRow>(
      this.db,
      `SELECT * FROM kb_documents WHERE id = ?`,
    ).get(id);
    return row ? rowToDoc(row) : null;
  }

  /** Delete a document and all its chunks. Returns true if anything was removed. */
  delete(id: string): boolean {
    const chunkIds = prepareCached<[string], { id: number }>(
      this.db,
      `SELECT id FROM kb_chunks WHERE document_id = ?`,
    )
      .all(id)
      .map((r) => r.id);

    const deleteVec = prepareCached<[bigint]>(this.db, `DELETE FROM kb_chunk_vectors WHERE rowid = ?`);
    const deleteFts = prepareCached<[bigint]>(this.db, `DELETE FROM kb_chunks_fts WHERE rowid = ?`);
    const deleteDoc = prepareCached<[string]>(this.db, `DELETE FROM kb_documents WHERE id = ?`);
    // kb_chunks rows are taken out by ON DELETE CASCADE from kb_documents.
    // The two virtual tables (vec0 + the managed fts5 table) don't honor
    // CASCADE, so we clean them manually by rowid before deleting the doc.
    const tx = this.db.transaction(() => {
      for (const cid of chunkIds) {
        deleteVec.run(BigInt(cid));
        deleteFts.run(BigInt(cid));
      }
      deleteDoc.run(id);
    });
    tx();
    return chunkIds.length > 0;
  }

  /**
   * Top-K nearest chunks for a query string. Embeds the query with the
   * configured embedder and runs vec0 KNN. Optionally scoped to an owner
   * and/or restricted to a set of document ids (e.g. when you want chunks
   * from one specific document only — used by per-doc RAG flows).
   */
  async search(
    query: string,
    opts: {
      topK?: number;
      ownerId?: string | null;
      documentIds?: readonly string[];
    } = {},
  ): Promise<KbSearchHit[]> {
    const topK = opts.topK ?? 5;
    if (!query.trim()) return [];

    const [vec] = await this.embedder.embed([query]);
    const ownerId = opts.ownerId ?? null;
    const documentIdSet =
      opts.documentIds && opts.documentIds.length > 0
        ? new Set(opts.documentIds)
        : null;

    // sqlite-vec KNN: WHERE embedding MATCH ? AND k = ? ORDER BY distance.
    // Over-fetch when post-filtering so we still end up with topK after
    // owner / documentId filtering.
    const oversample =
      ownerId || documentIdSet ? Math.max(topK * 4, 50) : topK;
    const rawRows = prepareCached<[Float32Array, number], { rowid: number | bigint; distance: number }>(
      this.db,
      `SELECT rowid, distance FROM kb_chunk_vectors
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance`,
    ).all(Float32Array.from(vec), oversample);

    if (rawRows.length === 0) return [];

    // rowid may come back as bigint from better-sqlite3 — coerce for SQL IN()
    // and for use as Map keys.
    const chunkIds = rawRows.map((r) => Number(r.rowid));
    const placeholders = chunkIds.map(() => '?').join(',');
    const rows = this.db
      .prepare<unknown[], ChunkJoinRow>(
        `SELECT
           c.id           AS chunk_id,
           c.document_id  AS document_id,
           c.chunk_index  AS chunk_index,
           c.content      AS content,
           c.start_char   AS start_char,
           c.end_char     AS end_char,
           d.name         AS doc_name,
           d.mime_type    AS doc_mime,
           d.size         AS doc_size,
           d.chunk_count  AS doc_chunks,
           d.owner_id     AS doc_owner,
           d.created_at   AS doc_created
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id IN (${placeholders})`,
      )
      .all(...chunkIds);

    // Re-attach distance + post-filter + preserve KNN order.
    const distance = new Map(rawRows.map((r) => [Number(r.rowid), r.distance]));
    const hits: KbSearchHit[] = rows
      .filter((r) => !ownerId || r.doc_owner === ownerId)
      .filter((r) => !documentIdSet || documentIdSet.has(r.document_id))
      .map((r) => ({
        chunk: {
          id: r.chunk_id,
          documentId: r.document_id,
          chunkIndex: r.chunk_index,
          content: r.content,
          startChar: r.start_char,
          endChar: r.end_char,
        },
        document: {
          id: r.document_id,
          name: r.doc_name,
          mimeType: r.doc_mime,
          size: r.doc_size,
          chunkCount: r.doc_chunks,
          ownerId: r.doc_owner,
          createdAt: r.doc_created,
        },
        distance: distance.get(r.chunk_id) ?? Infinity,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK);

    return hits;
  }

  /**
   * Top-K chunks for a query using FTS5 BM25 keyword search. Useful on its
   * own for explicit keyword needs, but the recommended path is
   * `searchHybrid`, which fuses this with vector results.
   *
   * Hits returned here have `distance: undefined` since BM25 isn't a
   * cosine distance — UI should treat absence as "keyword-only".
   */
  searchKeyword(
    query: string,
    opts: {
      topK?: number;
      ownerId?: string | null;
      documentIds?: readonly string[];
    } = {},
  ): KbSearchHit[] {
    const topK = opts.topK ?? 5;
    const fts = buildFtsQuery(query);
    if (!fts) return [];

    const ownerId = opts.ownerId ?? null;
    const documentIdSet =
      opts.documentIds && opts.documentIds.length > 0
        ? new Set(opts.documentIds)
        : null;
    const oversample =
      ownerId || documentIdSet ? Math.max(topK * 4, 50) : topK;

    // bm25() returns a numeric where lower = better; we don't expose it
    // outwards (distance is left undefined), but order by it here so the
    // best matches come first.
    const rows = this.db
      .prepare<unknown[], ChunkJoinRow & { bm25: number }>(
        `SELECT
           c.id           AS chunk_id,
           c.id           AS id,
           c.document_id  AS document_id,
           c.chunk_index  AS chunk_index,
           c.content      AS content,
           c.start_char   AS start_char,
           c.end_char     AS end_char,
           d.name         AS doc_name,
           d.mime_type    AS doc_mime,
           d.size         AS doc_size,
           d.chunk_count  AS doc_chunks,
           d.owner_id     AS doc_owner,
           d.created_at   AS doc_created,
           bm25(kb_chunks_fts) AS bm25
         FROM kb_chunks_fts
         JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid
         JOIN kb_documents d ON d.id = c.document_id
         WHERE kb_chunks_fts MATCH ?
         ORDER BY bm25
         LIMIT ?`,
      )
      .all(fts, oversample);

    return rows
      .filter((r) => !ownerId || r.doc_owner === ownerId)
      .filter((r) => !documentIdSet || documentIdSet.has(r.document_id))
      .slice(0, topK)
      .map((r) => ({
        chunk: {
          id: r.chunk_id,
          documentId: r.document_id,
          chunkIndex: r.chunk_index,
          content: r.content,
          startChar: r.start_char,
          endChar: r.end_char,
        },
        document: {
          id: r.document_id,
          name: r.doc_name,
          mimeType: r.doc_mime,
          size: r.doc_size,
          chunkCount: r.doc_chunks,
          ownerId: r.doc_owner,
          createdAt: r.doc_created,
        },
      }));
  }

  /**
   * Hybrid search: combine vector and keyword retrieval via Reciprocal
   * Rank Fusion (RRF). Each lane retrieves an over-sampled candidate set;
   * each chunk's contribution is `1 / (k + rank)` from each lane that
   * found it (k=60, the standard constant from Cormack et al.). Top-K
   * by fused score wins.
   *
   * RRF beats raw-score blending here because BM25 and cosine distance
   * live on incomparable scales — rank-only fusion sidesteps
   * normalization. See e.g. Pinecone / Weaviate / Elastic for the same
   * choice.
   */
  async searchHybrid(
    query: string,
    opts: {
      topK?: number;
      ownerId?: string | null;
      documentIds?: readonly string[];
    } = {},
  ): Promise<KbSearchHit[]> {
    const topK = opts.topK ?? 5;
    if (!query.trim()) return [];
    const oversample = Math.max(topK * 4, 20);
    const lanedOpts = { ...opts, topK: oversample };

    // Run both lanes in parallel — they hit different indexes and don't
    // contend on the same row. The keyword lane is sync but very fast;
    // wrapping in Promise.all keeps the structure symmetric.
    const [vectorHits, keywordHits] = await Promise.all([
      this.search(query, lanedOpts),
      Promise.resolve(this.searchKeyword(query, lanedOpts)),
    ]);

    const RRF_K = 60;
    type Slot = { hit: KbSearchHit; score: number };
    const fused = new Map<number, Slot>();
    vectorHits.forEach((h, i) => {
      fused.set(h.chunk.id, { hit: h, score: 1 / (RRF_K + (i + 1)) });
    });
    keywordHits.forEach((h, i) => {
      const existing = fused.get(h.chunk.id);
      const inc = 1 / (RRF_K + (i + 1));
      if (existing) {
        existing.score += inc;
        // Hit appears in both lanes — keep the vector hit (which already
        // carries `distance`) but add the keyword score.
      } else {
        fused.set(h.chunk.id, { hit: h, score: inc });
      }
    });

    return Array.from(fused.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.hit);
  }

  /** Total chunk count across all documents (or one owner's). */
  count(ownerId: string | null): { documents: number; chunks: number } {
    const docRow = ownerId
      ? prepareCached<[string], { n: number }>(
          this.db,
          `SELECT COUNT(*) AS n FROM kb_documents WHERE owner_id = ?`,
        ).get(ownerId)
      : prepareCached<[], { n: number }>(this.db, `SELECT COUNT(*) AS n FROM kb_documents`).get();
    const chunkRow = ownerId
      ? prepareCached<[string], { n: number }>(
          this.db,
          `SELECT COUNT(c.id) AS n FROM kb_chunks c
            JOIN kb_documents d ON d.id = c.document_id
            WHERE d.owner_id = ?`,
        ).get(ownerId)
      : prepareCached<[], { n: number }>(this.db, `SELECT COUNT(*) AS n FROM kb_chunks`).get();
    return { documents: docRow?.n ?? 0, chunks: chunkRow?.n ?? 0 };
  }

  /** Read all chunks for a document, ordered. Useful for debugging. */
  listChunks(documentId: string): KbChunk[] {
    const rows = prepareCached<[string], ChunkRow>(
      this.db,
      `SELECT id, document_id, chunk_index, content, start_char, end_char
         FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index`,
    ).all(documentId);
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      startChar: r.start_char,
      endChar: r.end_char,
    }));
  }
}

interface DocRow {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  markdown: string;
  chunk_count: number;
  owner_id: string | null;
  created_at: number;
}
interface ChunkRow {
  id: number;
  document_id: string;
  chunk_index: number;
  content: string;
  start_char: number;
  end_char: number;
}
interface ChunkJoinRow extends ChunkRow {
  chunk_id: number;
  doc_name: string;
  doc_mime: string;
  doc_size: number;
  doc_chunks: number;
  doc_owner: string | null;
  doc_created: number;
}

function rowToDoc(row: DocRow): KbDocument {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    chunkCount: row.chunk_count,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

function generateId(): string {
  return `kbdoc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Turn a free-text query into a safe FTS5 MATCH expression.
 *
 * - Lowercase + extract alphanumeric tokens (drops punctuation, accents
 *   handled later by the unicode61 tokenizer).
 * - Filter out 1-char tokens (BM25 won't usefully rank them).
 * - Cap at 32 tokens to keep the FTS5 parser happy on long HyDE answers.
 * - Wrap each token in double quotes so they're treated as literals,
 *   never as FTS5 operators (`OR`, `AND`, `NOT`, `*`, etc.). Join with
 *   `OR` so any-token match surfaces — BM25 ranks chunks by how many
 *   high-IDF tokens they contain anyway.
 */
function buildFtsQuery(input: string): string {
  const tokens = (input.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 2)
    .slice(0, 32);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}
