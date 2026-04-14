# @teamsuzie/db-client

Typed HTTP clients for the `vector-db` and `graph-db` services.

## What's here

- `VectorDbClient` — search, insert, delete against Milvus via the REST service.
- `GraphDbClient` — entity / relationship queries against Neo4j via the REST service.

Both accept `{ baseUrl, apiKey }` at construction. Agents use their own API key; internal services can pass a service key.

## Example

```typescript
import { VectorDbClient } from '@teamsuzie/db-client';

const vectors = new VectorDbClient({
  baseUrl: process.env.VECTOR_DB_URL!,
  apiKey: process.env.AGENT_API_KEY!,
});

const results = await vectors.search({
  query: 'project deadlines',
  scopes: [
    { scope: 'agent', scope_id: agentId },
    { scope: 'org', scope_id: orgId },
  ],
  limit: 10,
});
```

## Design notes

Client-only package — no connection pooling, no caching layer, just typed HTTP. If you want a swappable backend, fork the corresponding service, not this package.

## Status

v0.1 — being extracted.
