# graph-db

REST API wrapping Neo4j with scope-aware queries. **Port 3007.**

## What it does

- Stores entities and relationships, each tagged with `{scope, scope_id}`.
- Serves Cypher-backed queries parameterised by a scope list.
- Includes an entity-name similarity algorithm (see `docs/entity-name-similarity-algorithm.md` — coming in v0.2).

## Endpoints

```
POST /entities                   (upsert entity, with scope)
POST /relationships              (upsert relationship)
POST /search/entities            (search entities by name/type, with scopes[])
POST /search/paths               (graph traversal, with scopes[])
```

## Configuration

- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`.

## Security note

All Cypher queries use parameterized values for scope conditions. Do not concatenate user input into Cypher strings anywhere in this service — Neo4j injection is real.

## Status

v0.1 — being extracted.
