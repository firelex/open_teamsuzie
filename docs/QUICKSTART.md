# Quickstart

> **⚠️ v0.1 is a planning skeleton, not runnable code.** The steps below describe the *intended* developer experience at v0.2. Today, `pnpm install` will succeed but none of the services will start — the `apps/` and `packages/` directories contain READMEs, not implementations. If you want to see the code that backs this architecture, check the [private upstream](https://teamsuzie.com) or wait for v0.2 (tracked in [ROADMAP.md](ROADMAP.md)).
>
> What follows is the target quickstart, left in place so you can see where we're headed.

Gets you from zero to a running agent hitting a scoped knowledge base with an approval queue in front of it.

## Prerequisites

- Node 20+
- pnpm 9+
- Docker + Docker Compose
- ~8 GB free RAM (Milvus + Neo4j are not light)

## 1. Install

```bash
git clone https://github.com/firelex/teamsuzie
cd teamsuzie
pnpm install
```

## 2. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set OPENAI_API_KEY or ANTHROPIC_API_KEY.
# Defaults for Postgres/Redis/Milvus/Neo4j match the docker-compose below.
```

## 3. Start infrastructure

```bash
pnpm docker:up
```

This brings up Postgres, Redis, Milvus (with etcd + minio), and Neo4j. First start takes 1–2 minutes while images pull and Milvus initialises.

Verify:

```bash
docker compose -f docker/docker-compose.yml ps
```

## 4. Start the platform services

In separate terminals (or use a process manager like [mprocs](https://github.com/pvolok/mprocs)):

```bash
pnpm dev:auth         # :3005
pnpm dev:llm-proxy    # :4000
pnpm dev:vector-db    # :3006
pnpm dev:graph-db     # :3007
pnpm dev:admin        # :3008
```

## 5. Create an org and an agent

Open the admin UI at [http://localhost:3008](http://localhost:3008). Sign up with any email (no email verification in OSS dev mode). Create an org, then create an agent — copy the API key it gives you.

## 6. Run the demo agent

```bash
cd apps/demo
cp .env.example .env   # paste the agent API key into AGENT_API_KEY
pnpm dev
```

The demo agent:
1. Connects to the LLM proxy with its API key.
2. Queries the vector and graph DBs using its scope hierarchy.
3. Proposes actions to the approval queue for human review.

## Troubleshooting

**Milvus fails to start:** give Docker more memory (≥6 GB).

**`COOKIE_SECRET must be set`:** your `.env` is not being loaded. Confirm you copied `.env.example → .env` at the repo root, and that the service you're starting reads env from there.

**Auth service can't reach Postgres:** wait ~10s after `docker:up` — Postgres takes a moment to accept connections. Or check `docker compose ... logs postgres`.

**Port already in use:** another service is already bound to 3005/3006/3007/3008/4000. Override via env (`PORT=3105 pnpm dev:auth`).
