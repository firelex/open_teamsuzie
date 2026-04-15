# llm-proxy

Provider-agnostic LLM router with per-agent / per-org usage tracking. **Port 4000.**

## What it does

- Accepts LLM requests in OpenAI-compatible format.
- Routes to the configured provider (OpenAI, Anthropic, others via adapters).
- Emits per-request usage events to a Redis pub/sub channel for downstream aggregation.
- Handles prompt caching where the provider supports it.

## Why a proxy

Agents shouldn't talk to LLM providers directly. Centralizing through this service gives you:

- One place to rotate API keys.
- Per-agent cost visibility without instrumenting every agent.
- Provider portability: swap OpenAI for Anthropic without touching agent code.

## Endpoints

```
POST /v1/chat/completions        (OpenAI-compatible)
POST /v1/responses               (OpenAI Responses API → Chat Completions bridge)
POST /v1/embeddings              (OpenAI-compatible)
GET  /health
```

Admin-only (used by the admin app to hot-reload keys and config):

```
POST /admin/reload-keys
POST /admin/sync-org-keys
POST /admin/sync-agent-configs
```

Usage is published to Redis pub/sub on the `usage:events` channel (see `src/services/usage.ts`). Consumers aggregate per-agent / per-org totals downstream — the proxy does not expose its own `/usage` endpoints.

## Configuration

Provider keys go in env (see `.env.example` at the repo root) and can be hot-reloaded via `POST /admin/reload-keys`.

## What's not here

- **No billing logic.** Usage counters are raw tokens. Turning tokens into money (credits, invoices, Stripe) lives in the commercial product.
- **No rate limiting beyond provider defaults.** Add your own if you expose this service beyond localhost.

## Status

v0.1 — **runnable.** 28 unit tests cover body mutations, config loading, and dotenv bootstrapping.
