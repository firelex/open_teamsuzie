# graph-db

REST API for scope-aware graph queries. **Port 3007.**

Two backends behind the same REST contract — pick with `GRAPH_BACKEND`:

- `neo4j` (default) — full Cypher; required if callers use `/v1/query/cypher`.
- `pg` — Postgres with `graph_nodes` / `graph_edges` tables (plus `pg_trgm` for
  fuzzy entity search). The Cypher endpoint returns `501` on this backend; all
  entity / relationship endpoints work normally.

## What it does

- Stores entities and relationships, each tagged with `{scope, scope_id}`.
- Serves graph queries parameterised by a scope list.
- Includes an entity-name similarity algorithm (see `docs/entity-name-similarity-algorithm.md` — coming in v0.2).

## Endpoints

```
POST /entities                   (upsert entity, with scope)
POST /relationships              (upsert relationship)
POST /search/entities            (search entities by name/type, with scopes[])
POST /search/paths               (graph traversal, with scopes[])
```

## Configuration

- `GRAPH_BACKEND` — `neo4j` (default) or `pg`.
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` — used when `GRAPH_BACKEND=neo4j`.
- `POSTGRES_URL` — used when `GRAPH_BACKEND=pg`. The `pg_trgm` extension is
  created on first boot if missing (requires `CREATE EXTENSION` privilege).

## Security note

All Cypher queries use parameterized values for scope conditions. Do not concatenate user input into Cypher strings anywhere in this service — Neo4j injection is real.

## Status

v0.1 — being extracted.
