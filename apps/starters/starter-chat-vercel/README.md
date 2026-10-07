# starter-chat-vercel

Next.js 15 / Vercel-deployable variant of the Team Suzie chat starter. Same tool-use loop, skills bridge, and MCP client as [`starter-chat`](../starter-chat) — with the constraints of serverless surfaced honestly so you don't ship something that breaks under cold-start.

## What this starter is for

You want to deploy a Team Suzie agentic app to Vercel with a `Deploy` button or `vercel deploy`, not run a long-lived Express server. This template wraps the same agent core in Next.js App Router route handlers + a single React client component.

## What this starter does NOT support

These are real, intentional limitations of the Vercel runtime — not bugs. Read this section before you build on top of it.

### 1. No persistent in-process state across cold starts
The bundled `ApprovalQueue` uses an `InMemoryApprovalStore`. Module-scope state survives **warm restarts** within a single function instance, but a cold start (new instance, idle scale-to-zero, redeploy) wipes pending approvals.

**For real use:** swap the store. `ApprovalStore` is a small interface — implement it against [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres), [Vercel KV / Redis](https://vercel.com/docs/storage/vercel-kv), or [Upstash](https://upstash.com), and pass it into `new ApprovalQueue({ store })` in `lib/runtime.ts`. About 30 lines of code per store.

### 2. No stdio MCP servers — HTTP transport only
Stdio MCP servers spawn child processes; serverless functions can't spawn long-lived subprocesses. The bootstrap rejects `mcpServers` entries with `command` and surfaces a clear error.

**Workaround:** use only Streamable-HTTP MCP servers (`url` field). For stdio-style servers like `@modelcontextprotocol/server-filesystem`, run them on a real host (a VM, a container, the local Express starter) and front them with the HTTP transport, or use the local [`starter-chat`](../starter-chat) which spawns subprocesses fine.

### 3. No filesystem-based skill catalog — HTTP catalog only
The `STARTER_CHAT_SKILLS_DIR` option from the local starter doesn't exist here. Vercel's filesystem at runtime is read-only and bundle-scoped — skill files would have to be copied into the deployment, which couples skill changes to redeploys.

**For real use:** stand up an `HttpSkillSource` catalog ([reference implementation](../../examples/skill-catalog-host)) and point `SKILL_CATALOG_URL` at it. Skills update independently of the app deploy.

### 4. Tool-use loops bound by `maxDuration`
`/api/chat` is configured with `maxDuration = 60` (seconds). On Vercel's Hobby plan that's the cap; Pro raises it to 300; Enterprise higher. A multi-turn tool-use loop with multiple model calls + slow tools (e.g. async LLM-side processing) can hit it.

**Workaround:** raise `maxDuration` for your plan, or move long work into a background job (queue + worker, e.g. [Trigger.dev](https://trigger.dev) or Vercel Cron) and have the tool return a job-id immediately.

### 5. No long-running background work / no SIGINT/SIGTERM hooks
The `starter-chat` cleanup hooks for MCP disconnect on shutdown don't apply here — serverless functions just go away. MCP HTTP connections are re-established on cold start.

### 6. No persistent skills/MCP cache between cold starts
Each cold start re-fetches the skill catalog and re-connects MCP servers. Latency cost is baked in. The local Express starter loads once at boot and never re-fetches.

## What it *does* give you

- **App Router + streaming.** `/api/chat` returns a `ReadableStream` that streams `chunk` / `tool_call` / `tool_result` / `tool_error` / `done` events as the model + tool-use loop runs.
- **All three extension surfaces** from the local starter:
  - **Typed tools** — `vector_search`, `propose_action`, `http_request` (in `lib/config.ts`).
  - **Skills bridge** — HTTP catalog only, rendered into the system prompt at first request.
  - **MCP client** — Streamable HTTP servers, configured inline via `MCP_CONFIG_JSON` env var.
- **Approvals review endpoints** at `GET /api/approvals` and `POST /api/approvals/:id/review` (memory-only — see limitation #1).
- **Same tool-use loop semantics** — drop-in compatible with the local starter's tools and skills.

## Deploy to Vercel

### One-click

The fastest path. After you've forked or pushed this repo:

```
https://vercel.com/new/clone?repository-url=https://github.com/<your-org>/<your-fork>&root-directory=apps/starters/starter-chat-vercel
```

Set the env vars at deploy time (Vercel will prompt). At minimum:

- `AGENT_BASE_URL` — your OpenAI-compatible endpoint
- `AGENT_API_KEY`
- `AGENT_MODEL`

### Vercel CLI

```bash
npm i -g vercel
cd apps/starters/starter-chat-vercel
vercel link        # one-time: bind to a project
vercel env pull    # pull env vars from the project
vercel deploy      # preview deploy
vercel deploy --prod
```

### Custom domain

`vercel domains add <yourdomain.com>` from this directory after `vercel link`, or attach via the Vercel dashboard. CORS is not relevant — the client and API live in the same origin.

### Logs and monitoring

- `vercel logs <deployment-url>` for tailing
- The Vercel dashboard's **Logs** tab for filtering / structured search
- For richer observability, add [Vercel Analytics](https://vercel.com/docs/analytics) or wire OpenTelemetry into the route handlers (out of scope for this starter)

## Local development

```bash
cp apps/starters/starter-chat-vercel/.env.example apps/starters/starter-chat-vercel/.env
pnpm dev:starter-chat-vercel
```

Open http://localhost:19311. The `predev` script builds the workspace deps (`@teamsuzie/approvals`, `@teamsuzie/skills`, `@teamsuzie/ui`) so their `dist/` folders exist before Next.js bundles.

## Configuration

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_TITLE` | Title shown in the chat header |
| `NEXT_PUBLIC_AGENT_NAME` | Agent display name |
| `AGENT_BASE_URL` | OpenAI-compatible base URL |
| `AGENT_MODEL` | Model id sent to `/v1/chat/completions` |
| `AGENT_API_KEY` | Optional bearer token |
| `VECTOR_DB_BASE_URL` | Where `vector_search` should POST |
| `VECTOR_DB_API_KEY` | Optional `X-Agent-API-Key` for vector-db |
| `TOOL_MAX_ITERATIONS` | Cap on tool-use loop iterations. Default `6`. |
| `HTTP_ALLOWED_HOSTS` | Comma-separated extra hosts for `http_request`. Skill render-context URL hosts are auto-included. |
| `SKILL_CATALOG_URL` | Remote skill catalog (`HttpSkillSource`) URL |
| `SKILL_CATALOG_TOKEN` | Bearer for the catalog |
| `SKILLS_ALLOW` | Comma-separated subset of skill names to install. Empty = all. |
| `SKILL_VAR_<NAME>` | `{{NAME}}` substitution for skill markdown. URL values auto-extend the `http_request` allow-list. |
| `MCP_CONFIG_JSON` | Inline JSON, Claude Desktop `mcpServers` shape — **HTTP transport only**. |

## Attaching a database for real persistence

The fastest path to making approvals durable on Vercel:

1. **Provision** Vercel Postgres or Vercel KV from the dashboard.
2. **Install** the relevant client (`@vercel/postgres`, `@vercel/kv`, or `@upstash/redis`).
3. **Implement** `ApprovalStore` (see [`packages/approvals/src/store.ts`](../../../packages/approvals/src/store.ts)) — five async methods.
4. **Wire it up** in `lib/runtime.ts`:
   ```ts
   import { ApprovalQueue } from '@teamsuzie/approvals';
   import { MyPostgresApprovalStore } from './stores/postgres';
   const approvals = new ApprovalQueue({ store: new MyPostgresApprovalStore() });
   ```

Same shape applies to swapping `InMemoryApprovalStore` for any backend you prefer.

## Architecture

The agent-loop core (`runChatTurn`, skills loader, MCP client, built-in tools) lives in the `@teamsuzie/agent-loop` workspace package and is shared with [`starter-chat`](../starter-chat). This template only adds the Vercel-specific pieces:

- `lib/config.ts` — env-var bindings (no `STARTER_CHAT_` prefix; this app is freestanding).
- `lib/runtime.ts` — lazy module-scope bootstrap that survives warm restarts on a single function instance.
- `app/api/*` — App Router route handlers wrapping the loop in SSE streaming responses.
- `components/chat.tsx` — the `'use client'` chat UI.

If you change the loop, change it in `packages/agent-loop` and rebuild — both starters pick it up.

## Tests

```bash
pnpm --filter @teamsuzie/starter-chat-vercel test
```

A single sanity test verifying the tool-use loop dispatches `vector_search` correctly via stubbed fetch. The full skills-bridge and MCP test suites live in [`starter-chat`](../starter-chat) and exercise the same code paths.
