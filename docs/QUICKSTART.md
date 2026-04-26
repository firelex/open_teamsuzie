# Quickstart

> **v0.1 note:** platform services (steps 1–4) build, test, and run today — `pnpm install && pnpm -r build && pnpm -r test` is green, and the dev scripts below start real services. Steps 5–6 describe the admin UI and the demo agent, which land at v0.3 (tracked in [ROADMAP.md](ROADMAP.md)). Until then, build against the REST APIs directly.

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

### Optional: get a bearer token for a mobile / Flutter / standalone client

Once `auth` is running, you can issue a client token with:

```bash
curl -X POST http://localhost:3005/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Auth-Flow: bearer' \
  -d '{
    "email": "you@example.com",
    "password": "your-password",
    "issue_bearer_token": true,
    "token_name": "flutter-dev"
  }'
```

That returns a one-time `access_token` you can use as:

```bash
Authorization: Bearer <token>
```

## 5. Create an org and an agent *(v0.3)*

Open the admin UI at [http://localhost:3008](http://localhost:3008). Sign up with any email (no email verification in OSS dev mode). Create an org, then create an agent — copy the API key it gives you.

## Troubleshooting

**Milvus fails to start:** give Docker more memory (≥6 GB).

**`COOKIE_SECRET must be set`:** your `.env` is not being loaded. Confirm you copied `.env.example → .env` at the repo root, and that the service you're starting reads env from there.

**Auth service can't reach Postgres:** wait ~10s after `docker:up` — Postgres takes a moment to accept connections. Or check `docker compose ... logs postgres`.

**Port already in use:** another service is already bound to 3005/3006/3007/3008/4000. Override via env (`PORT=3105 pnpm dev:auth`).
