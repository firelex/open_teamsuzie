# Storage backends

`open_teamsuzie` ships two backends for both the vector store and the graph
store, switchable per service via env var. Application code only ever talks to
the REST contract — callers (`@teamsuzie/db-client`, the agent runtime, admin
UI) do not change with the backend.

## Vector store

`apps/platform/vector-db` exposes the `VectorStore` interface
(`src/services/vectorStore.ts`). Two implementations:

| Env                          | Implementation                  | Notes                                                                |
| ---------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `VECTOR_BACKEND=milvus` (default) | `src/services/milvus.ts`    | Milvus standalone. Best at scale (10M+ vectors), hybrid search.      |
| `VECTOR_BACKEND=pgvector`    | `src/services/pgvector.ts`      | Postgres + `pgvector`. HNSW index, cosine distance. Single-DB setup. |

Tables for the pgvector backend are suffixed by `EMBEDDING_PROFILE_ID` (or
`PGVECTOR_TABLE_SUFFIX`) so models with different dimensions never collide.

## Graph store

`apps/platform/graph-db` exposes the `GraphStore` interface
(`src/services/graphStore.ts`). Two implementations:

| Env                            | Implementation              | Notes                                                                              |
| ------------------------------ | --------------------------- | ---------------------------------------------------------------------------------- |
| `GRAPH_BACKEND=neo4j` (default) | `src/services/neo4j.ts`    | Full Cypher. Required if callers use `/v1/query/cypher`.                           |
| `GRAPH_BACKEND=pg`             | `src/services/pgGraph.ts`   | Postgres tables `graph_nodes` + `graph_edges`. `pg_trgm` for fuzzy entity search.  |

The Cypher endpoint (`POST /api/v1/query/cypher`) returns `501 Not Implemented`
on the Postgres backend. Every other entity/relationship endpoint works
identically.

## Choosing

Pick the **lite** profile (`VECTOR_BACKEND=pgvector`, `GRAPH_BACKEND=pg`) when:

- You're shipping `open_teamsuzie` to a project that does not need Milvus/Neo4j
  scale.
- You want a single database to back up, monitor, and run migrations against.
- You are self-hosting and want to minimise moving parts.

Stay on the **default** profile when:

- Vector corpus is > 10M items, or you rely on Milvus hybrid/sparse search.
- You depend on Cypher graph traversals or APOC procedures.
- You already run Neo4j/Milvus for other workloads.

See `docker/lite.env.example` for an example env file, and
`docker/docker-compose.yml` — heavy services (`neo4j`, `milvus`, `etcd`,
`minio`) sit behind the `heavy` compose profile, so the default `docker
compose up` brings up only Postgres + Redis.
