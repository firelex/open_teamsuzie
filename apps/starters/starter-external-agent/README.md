# starter-external-agent

Scaffold for an **external marketplace agent** — a chatbot with custom tools that registers with the `suzie_monorepo` mothership platform via [`@teamsuzie/platform-bridge`](../../../packages/platform-bridge/README.md).

This starter is the canonical answer to "I want to build my own agent and have it show up in the platform's marketplace." It's a fork of `starter-chat` with three things layered on top:

1. **Marketplace registration** on boot — `registerWithPlatform()` posts your manifest to the mothership; the platform catalogs it and starts polling `/api/health`.
2. **Webhook router** at `/api/webhook/mothership` — handles `install`, `uninstall`, `dm`, and `ping` from the platform, all gated by a shared `X-Platform-Token`.
3. **Auth gate** on `/api/*` — the chat endpoint and everything else require a session, populated either from a valid `X-Platform-Token` (mothership-proxied requests) or from a local-dev bypass. Cookie auth for end-user web traffic is opt-in via composition.

`suzielaw` is the reference vertical agent built on this exact pattern. SuzieCode generates new agents from this starter.

## What you get out of the box

Inherited from `starter-chat`:
- Express backend + Vite/React client with streaming chat (SSE)
- Tool-use loop via `@teamsuzie/agent-loop`
- Built-in tools: `vector_search`, `propose_action`, `http_request`
- File attachments, document navigation/drafting, MCP client, skills bridge
- File-based persona registry, persisted top-level chat history (SQLite)

Added on top:
- `registerWithPlatform()` call in `main()`, guarded by `PLATFORM_URL`
- `createWebhookRouter()` mounted at `/api/webhook/mothership` with sensible default `onInstall` / `onUninstall` / `onDirectMessage` handlers (the DM handler delegates to `runWebhookChatTurn` — same tools as `/api/chat`)
- `validatePlatformRequest` middleware on `/api/*` — synthesizes `req.session` from a valid `X-Platform-Token`
- `requireAgentSession` middleware on `/api/*` — 401 unless a session is present (allow-listed: `/api/health`, `/api/webhook/...`)
- `injectDevSession` middleware behind `AGENT_DEV_AUTH=true` for local dev — refused at boot in production

## Quick start

```bash
cp .env.example .env
# Edit .env to set AGENT_BASE_URL + AGENT_API_KEY for your LLM provider.
# Leave the PLATFORM_* block commented for now — local dev doesn't need it.

pnpm install
pnpm dev
```

Open the React UI at `http://localhost:17276`.

## Three deploy modes

### 1. Local dev (no mothership)

Leave the entire `PLATFORM_*` block unset. The starter:
- Skips `registerWithPlatform`
- Skips mounting `/api/webhook/mothership`
- Still requires `AGENT_DEV_AUTH=true` for the local React UI to reach `/api/*` (otherwise 401)

Use this mode for iterating on tools and persona before connecting to the platform.

### 2. Marketplace agent (production)

Set `PLATFORM_URL`, `PLATFORM_TOKEN`, `PLATFORM_SLUG`, `PLATFORM_NAME` (and friends). Unset `AGENT_DEV_AUTH`. Make sure `NODE_ENV=production`.

- The agent registers on boot. Mothership starts polling `/api/health` every 60s.
- `/api/chat` only accepts requests bearing `X-Platform-Token` — the mothership's chat proxy. End users interact through the platform's admin UI / chat surfaces, not your agent's URL directly.
- `/api/webhook/mothership` accepts install/uninstall/DM events from the platform, gated by the same token.

`PLATFORM_TOKEN` must equal the mothership's `INTERNAL_SERVICE_KEY`. Same secret, both directions.

### 3. Marketplace agent + standalone web product

If your agent also serves real end users from its own URL (suzielaw is the canonical example), layer cookie auth in front of `requireAgentSession`:

```ts
// Pseudocode — see suzielaw for a real implementation.
import { createSessionMiddleware, requireAuth } from '@teamsuzie/shared-auth';

app.use('/api', createPlatformRequestMiddleware(platformBridgeConfig)); // unchanged
app.use('/api', createSessionMiddleware({ /* your config */ }));        // NEW: cookie auth
app.use('/api', requireAgentSession());                                  // unchanged — accepts either source
```

Cookie auth and the platform-token middleware both populate `req.session.user`; `requireAgentSession` doesn't care which one wrote it.

## Environment variables

Two prefixes:

| Prefix | What |
|---|---|
| `AGENT_*` | Your agent's own config (port, model, tool limits, persona dir, …) |
| `PLATFORM_*` | Mothership integration (URL, token, slug, manifest fields) |

See `.env.example` for the full list with defaults.

## Marketplace lifecycle (TL;DR)

```
agent boots
  └─ registerWithPlatform()  →  POST /api/marketplace/register  →  catalog row upserted by slug
                                                                  health polling begins

admin installs agent for org X
  └─ POST /api/webhook/mothership  { type: "install", context: { ... } }
                                                                  → onInstall handler

org user chats with agent via mothership UI
  └─ mothership chat proxy  →  POST /api/chat  + X-Platform-Token + context.user_*
                                                                  validatePlatformRequest synthesizes session
                                                                  requireAgentSession passes
                                                                  /api/chat streams SSE back

another agent DMs this one (inter-agent)
  └─ POST /api/webhook/mothership  { type: "dm", from_agent, message, context? }
                                                                  → onDirectMessage  →  runWebhookChatTurn
```

Full reference: `suzie_monorepo/apps/docs/MARKETPLACE_AND_EXTERNAL_AGENTS.md`.

## Extending

- **Add a custom tool** — drop it into `src/tools/`, import into `activeTools()`. The capability list in your registration manifest is auto-derived from `activeTools()` so the marketplace stays in sync.
- **Add a persona** — create `<personas-dir>/<id>/PERSONA.md` and set `AGENT_PERSONAS_DIR`.
- **Persist `platform_api_key` per org** — fill in `onInstall` to save it; you'll need it later if you call platform tools (e.g. `vector_search` against the org's KB).
- **Add cookie auth** — see deploy mode 3 above.

## Related

- [`@teamsuzie/platform-bridge`](../../../packages/platform-bridge/README.md) — the integration package this starter wires up
- [`starter-chat`](../starter-chat/README.md) — the base this starter forks; useful when you want a chatbot with no marketplace integration
- `suzielaw` — production reference external agent built on this same shape
