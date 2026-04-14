# llm-proxy

Provider-agnostic LLM router with per-agent / per-org usage tracking. **Port 4000.**

## What it does

- Accepts LLM requests in OpenAI-compatible format.
- Routes to the configured provider (OpenAI, Anthropic, others via adapters).
- Records token usage per agent and per org into Redis-backed counters.
- Handles prompt caching where the provider supports it.

## Why a proxy

Agents shouldn't talk to LLM providers directly. Centralizing through this service gives you:

- One place to rotate API keys.
- Per-agent cost visibility without instrumenting every agent.
- Provider portability: swap OpenAI for Anthropic without touching agent code.

## Endpoints

```
POST /v1/chat/completions        (OpenAI-compatible)
POST /v1/messages                (Anthropic-compatible)
GET  /usage/agent/:id            (cumulative tokens for an agent)
GET  /usage/org/:id              (cumulative tokens for an org)
```

## Configuration

Provider keys go in env or via the admin UI's config panel. See `.env.example`.

## What's not here

- **No billing logic.** Usage counters are raw tokens. Turning tokens into money (credits, invoices, Stripe) lives in the commercial product.
- **No rate limiting beyond provider defaults.** Add your own if you expose this service beyond localhost.

## Status

v0.1 — being extracted.
