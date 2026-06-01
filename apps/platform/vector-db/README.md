# vector-db

REST API wrapping Milvus with scope-aware search. **Port 3006.**

## What it does

- Accepts documents to embed and index, tagged with a `{scope, scope_id}` pair.
- Serves queries that can search across a list of scopes (e.g., agent + org + global).
- Embeds via a configured provider (OpenAI by default; pluggable).

## Endpoints

```
POST /documents                  (insert, with scope)
POST /search                     (query, with scopes[])
DELETE /documents/:id            (remove)
```

## Configuration

- `MILVUS_ADDRESS` — host:port of your Milvus instance (defaults to the Docker Compose target).
- `OPENAI_API_KEY` (or your chosen embedding provider key).
- `EMBEDDING_PROFILE_ID` — stable id for the active embedding profile. Non-default
  profiles get separate Milvus collection names so vectors with different
  dimensions/models are not mixed.
- `EMBEDDING_RUNTIME` — `openai-compatible` (default) or `llama.cpp`.
- `EMBEDDING_MODALITY` — `text` (default) or `multimodal`.
- `EMBEDDING_DIMENSIONS` / `MILVUS_DIMENSION` — vector size for the active
  profile. This must match the model output and the Milvus collection.
- `EMBEDDING_INCLUDE_DIMENSIONS=false` — omit the `dimensions` field when
  calling OpenAI-compatible embedding endpoints that reject it.
- `LLAMACPP_EMBEDDING_BASE_URL` — base URL for a llama.cpp server running with
  `--embedding`.
- `LLAMACPP_EMBEDDING_ENDPOINT` — defaults to `/embedding`, the llama.cpp
  endpoint that supports multimodal embedding prompts.

### llama.cpp multimodal / PDF-page embeddings

For local vision embeddings, run llama.cpp with the embedding model and a
non-`none` pooling mode, for example:

```bash
llama-server \
  -m /path/to/Qwen3-VL-Embedding-8B-Q8_0.gguf \
  --embedding \
  --pooling cls
```

Then start vector-db with a multimodal profile:

```bash
EMBEDDING_PROFILE_ID=qwen3-vl-embedding-8b-q8_0 \
EMBEDDING_RUNTIME=llama.cpp \
EMBEDDING_MODALITY=multimodal \
EMBEDDING_DIMENSIONS=<model-output-dim> \
LLAMACPP_EMBEDDING_BASE_URL=http://localhost:8080 \
pnpm --filter @teamsuzie/vector-db dev
```

Render PDFs to page images in the app or worker, then call the existing chunk or
upsert endpoints with `image_base64`/`media_base64` and
`embedding_profile`. The service sends the image to llama.cpp, receives a
vector, and stores it in the profile-specific Milvus collection with your
document/page metadata.

## Swapping backends

This service is intentionally thin. To run on a different vector DB (Pinecone, Qdrant, pgvector):

1. Fork this app.
2. Replace the Milvus driver with your backend.
3. Keep the HTTP contract (`/documents`, `/search`) identical.

The `@teamsuzie/db-client` package only sees the HTTP API, so downstream code doesn't change.

## Status

v0.1 — being extracted.
