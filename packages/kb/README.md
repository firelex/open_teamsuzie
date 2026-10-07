# @teamsuzie/kb

Lightweight RAG knowledge base: sqlite-vec storage plus an OpenAI-compatible
embedder, hybrid (vector + keyword) search, and an `@teamsuzie/agent-loop`
tool. Use it when an app needs to index documents and let a model search
them instead of stuffing full document text into the prompt.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import {
  KB_MIGRATIONS,
  KnowledgeBaseStore,
  createOpenAIEmbedder,
  createKbSearchTool,
} from '@teamsuzie/kb';

const db = openDb({ path: './data/kb.db', migrations: KB_MIGRATIONS });

const embedder = createOpenAIEmbedder({
  baseUrl: 'https://api.openai.com',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',
  dim: 1536,
});

const store = new KnowledgeBaseStore({ db, embedder });

await store.insert({
  name: 'policy.md',
  mimeType: 'text/markdown',
  size: 4096,
  markdown: '# Expense policy\n\n...',
});

const hits = await store.searchHybrid('what is the per-diem limit?', { topK: 5 });

const kbSearchTool = createKbSearchTool({ store, defaultTopK: 5 });
```

## Main exports

- `KnowledgeBaseStore` — insert / list / get / delete documents, and
  `search` (vector), `searchKeyword` (FTS5 BM25), `searchHybrid`
  (reciprocal rank fusion of both). Loads the `sqlite-vec` extension on
  construction and creates the `kb_chunk_vectors` vec0 table and the
  `kb_chunks_fts` FTS5 table.
- `KB_MIGRATIONS` — pass to `openDb({ migrations })` from
  `@teamsuzie/db-sqlite` to create `kb_documents` / `kb_chunks`.
- `chunkMarkdown` — splits markdown into overlapping, paragraph-aware chunks
  (default 3200-char target, 400-char overlap, 4800-char hard max).
- `createOpenAIEmbedder` — minimal client for any OpenAI-compatible
  `/v1/embeddings` endpoint, with sequential batching for providers that cap
  inputs per request.
- `createKbSearchTool` — builds a `kb_search` tool definition shaped for
  `@teamsuzie/agent-loop`'s tool registry.
- `WorkspaceRag` — per-workspace glue that converts an uploaded file to
  markdown (via `@teamsuzie/document-conversion`), indexes it into the KB
  with `ownerId = workspace:<id>`, and tracks the `(workspaceId, fileId)` →
  `kbDocId` mapping in a `workspace_doc_index` table (callers must create
  that table themselves — see the JSDoc on `WorkspaceRagOptions` for the
  schema).
- `rewriteQueryAsHypothetical` — HyDE: asks a model for a one-sentence
  hypothetical answer to embed instead of the raw question, for better
  retrieval against source-document prose. Use `DEFAULT_HYDE_FORMAT_HINTS`
  or supply your own `formatHints` map.

## Configuration

- `EmbedderConfig.dim` must match the model's real output dimension — a
  mismatched vector throws on the first embed call.
- `EmbedderConfig.batchSize` (default 10) caps how many inputs go in one
  `/v1/embeddings` request; larger corpora are split into sequential
  batches.
- `KnowledgeBaseStoreOptions.skipExtensionLoad` skips loading `sqlite-vec`
  — use this in tests where the extension is already loaded on the shared
  connection.

## Notable behaviour

- The store is single-tenant by default; pass `ownerId` on insert and
  filter reads by it for per-user/per-workspace scoping (`WorkspaceRag`
  does this automatically).
- `search`/`searchKeyword`/`searchHybrid` over-fetch when filtering by
  `ownerId` or `documentIds` so the post-filtered result still has up to
  `topK` hits.
- Originals aren't stored — only the converted markdown, chunks, and
  embeddings. Re-insert (re-upload) to refresh a document.
