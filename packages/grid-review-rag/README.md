# @teamsuzie/grid-review-rag

A retrieval-augmented `RunCellAdapter` for `@teamsuzie/grid-review`: for each grid cell it does HyDE-rewrite + retrieval against an indexed document (via `@teamsuzie/kb`'s `WorkspaceRag`), or falls back to converting and prompting over the full document when the doc isn't indexed yet. Use it to drive a document-review grid off an LLM without wiring retrieval and streaming yourself.

```ts
import { buildRagRunCellAdapter, makeStreamCompletion } from '@teamsuzie/grid-review-rag';

const llmStream = makeStreamCompletion({
  baseUrl: 'https://api.openai.com',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4.1',
});

const adapter = buildRagRunCellAdapter({
  rag: workspaceRag, // a @teamsuzie/kb WorkspaceRag instance
  loadFileBytes: async (workspaceId, externalDocId) => fileStore.getBytes(workspaceId, externalDocId),
  hydeRewrite: async (question, formatKey) => rewriteQueryAsHypothetical(question, formatKey),
  llmStream,
  markitdownBaseUrl: 'http://localhost:5100',
  topK: 6,
});

// `adapter` implements grid-review's RunCellAdapter contract — pass it to
// whatever drives your review grid's cell runs.
```

## Main exports

- `buildRagRunCellAdapter(opts: RagAdapterOptions)` — returns a `RunCellAdapter`. Required options: `rag`, `loadFileBytes`, `hydeRewrite`, `llmStream`, `markitdownBaseUrl`. Optional: `topK` (default 6) and `convertToMarkdown` (overrides the default fallback, which uses `@teamsuzie/document-conversion`'s `convertToMarkdown`).
- `makeStreamCompletion(opts: StreamCompletionOptions)` — builds a minimal OpenAI-compatible streaming-chat `LlmStream` from `{ baseUrl, apiKey, model, extraBody?, fetchImpl? }`.

## Notable behaviour

- If the document is indexed in `WorkspaceRag`, the adapter HyDE-rewrites the column prompt, retrieves the top-K chunks, and assembles a `PreparedDocument` whose body is the labelled excerpts (`[Excerpt 1]`, `[Excerpt 2]`, ...) rather than the full text.
- If `hydeRewrite` throws, the adapter logs a warning and falls back to retrieving with the raw column prompt instead of failing the cell.
- If the document isn't indexed, it loads the raw bytes, converts them to markdown, and prompts over the full document (yielding a `retrieved` event noting "Indexing not ready").
- `makeStreamCompletion` skips `@teamsuzie/agent-loop`'s tool-calling machinery — it issues plain chat completions only, matching grid-review's cell-run needs.

## Used by

`@teamsuzie/agent-runtime` (catalog modules, the local run adapter, and the server entrypoint).
