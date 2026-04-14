# @teamsuzie/types

Shared TypeScript types used across every package and app in Team Suzie.

## What's here

- `Scope`, `ScopeRef`, `ScopedEntity` — the multi-tenancy primitives. Every piece of state in the system carries one of these.
- `AgentContext` — the request context passed to any code running on behalf of an agent (agent id, org id, scope chain, API key claims).
- `VectorSearchRequest`, `VectorSearchResult` — wire types for `apps/vector-db`.
- `GraphEntityRequest`, `GraphSearchResult` — wire types for `apps/graph-db`.

## Design notes

Everything here is **pure types + zod schemas**. No runtime imports, no env vars, no DB connections. This package must be importable in any context (browser, server, worker) with zero side effects.

If you're tempted to add a class or a service here — it belongs in a different package.

## Status

v0.1 — being extracted from the private monorepo.
