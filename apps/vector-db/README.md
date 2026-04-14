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

## Swapping backends

This service is intentionally thin. To run on a different vector DB (Pinecone, Qdrant, pgvector):

1. Fork this app.
2. Replace the Milvus driver with your backend.
3. Keep the HTTP contract (`/documents`, `/search`) identical.

The `@teamsuzie/db-client` package only sees the HTTP API, so downstream code doesn't change.

## Status

v0.1 — being extracted.
