# starter-chat

Minimal full-stack chatbot starter for OpenAI-compatible backends, with a built-in tool-use loop.

## What it shows

- Express backend that proxies to a configured OpenAI-compatible chat backend
- React client with streaming chat (SSE) and a **multi-page shell** built on `@teamsuzie/ui` (`AppShell`, `Sidebar`, `PageHeader`) and `react-router` — Assistant / Library / History pages, ready to extend
- **File attachments** — paperclip in the composer accepts any file (configurable cap; default 25MB). Text-like files are read as UTF-8 and prepended to the user message; binaries are surfaced as metadata only ("`report.docx` — DOCX, 14KB; no extraction tool wired"). Per-session, in-memory; resets on restart.
- **Tool-use loop**: when the model emits `tool_calls`, the backend dispatches them, feeds results back, and re-calls the model — no second runtime needed
- **Three built-in tools** wired to Team Suzie pillars:
  - `vector_search` — calls `vector-db` (`:3006`)
  - `propose_action` — enqueues a proposal in the in-process approval queue (`@teamsuzie/approvals`)
  - `http_request` — generic, allow-list-gated HTTP capability that the model uses to call services described in installed skills
- **Skills bridge**: at server start, the starter loads skills from a local templates directory and/or a remote catalog (`HttpSkillSource`), renders them with placeholder substitution, and injects the rendered markdown into the chat system prompt. The model reads the skill, formulates an HTTP call, and dispatches it via `http_request`.
- **MCP client**: connect to external [Model Context Protocol](https://modelcontextprotocol.io) servers (stdio or Streamable HTTP). Each MCP tool surfaces in the registry as `<server>__<tool>` and is dispatched the same way the built-in tools are.
- Approvals review endpoints at `GET /api/approvals` and `POST /api/approvals/:id/review`
- A clean base to extend into a more specific app

## Setup

```bash
cp apps/starters/starter-chat/.env.example apps/starters/starter-chat/.env
pnpm dev:starter-chat
```

Then open `http://localhost:17276`.

## Configuration

Set these in `.env`:

| Variable | Purpose |
|---|---|
| `STARTER_CHAT_AGENT_BASE_URL` | OpenAI-compatible base URL |
| `STARTER_CHAT_MODEL` | Model string sent to `/v1/chat/completions`. Use a model that supports tool use (e.g. `openai/gpt-4.1-mini`). |
| `STARTER_CHAT_AGENT_API_KEY` | Optional bearer token |
| `STARTER_CHAT_AGENT_NAME` | Label shown in the UI |
| `STARTER_CHAT_PORT` / `STARTER_CHAT_CLIENT_PORT` | Backend / frontend ports |
| `STARTER_CHAT_VECTOR_DB_BASE_URL` | Where `vector_search` should POST. Default `http://localhost:3006`. |
| `STARTER_CHAT_VECTOR_DB_API_KEY` | Optional `X-Agent-API-Key` for vector-db |
| `STARTER_CHAT_TOOL_MAX_ITERATIONS` | Cap on tool-use loop turns. Default `6`. |
| `STARTER_CHAT_SKILLS_DIR` | Local directory of `<skill>/SKILL.md` files to install. Set to `../../packages/skills/templates` for the bundled skills. |
| `STARTER_CHAT_SKILL_CATALOG_URL` | Remote catalog (e.g. `apps/examples/skill-catalog-host`). |
| `STARTER_CHAT_SKILL_CATALOG_TOKEN` | Optional bearer for the remote catalog. |
| `STARTER_CHAT_SKILLS_ALLOW` | Comma-separated subset of skills to install. Empty = install all. |
| `STARTER_CHAT_SKILL_VAR_<NAME>` | `{{NAME}}` substitution for skill markdown. Any URL value auto-extends the `http_request` allow-list. |
| `STARTER_CHAT_HTTP_ALLOWED_HOSTS` | Extra `host[:port]` entries (comma-separated) for `http_request`. Hosts referenced in skill placeholders are auto-included; only set this for hosts not in any skill. |
| `STARTER_CHAT_MCP_CONFIG` | Path to a JSON file (Claude Desktop `mcpServers` shape) configuring external MCP servers. |

## Tool use

The backend runs the standard OpenAI tool-use loop:

1. Forward chat to `${STARTER_CHAT_AGENT_BASE_URL}/v1/chat/completions` with `tools: [...]` describing the registered tools.
2. If the model returns `finish_reason: tool_calls`, dispatch each call against the registry, append `role: 'tool'` messages, and re-call.
3. Repeat until the model returns `finish_reason: stop` or the iteration cap is hit.

Tool steps are streamed to the client as new SSE events alongside text chunks:

```text
{ type: 'chunk', text }                     # incremental assistant text
{ type: 'tool_call', id, name, args }       # model decided to call a tool
{ type: 'tool_result', id, name, result }   # tool returned successfully
{ type: 'tool_error', id, name, error }     # tool threw
{ type: 'done' }
{ type: 'error', message }                  # fatal
```

The client renders each tool call as a collapsible card inside the assistant's message, so the user sees what the agent is doing during multi-step turns.

## Three ways to give the agent a capability

| | Typed tool (`src/tools/`) | Skill (markdown) | MCP server |
|---|---|---|---|
| Authoring | TS file with JSON Schema parameters | `SKILL.md` with frontmatter + prose | Whatever the server author chose |
| Execution | Direct `execute(args)` dispatch | Model formulates HTTP call → dispatched via `http_request` | `tools/call` over the MCP transport |
| Strict schemas | Yes | No (prose) | Yes (server provides JSON Schema) |
| Distribution | Edit code, restart | Drop in `STARTER_CHAT_SKILLS_DIR`, or pull from a catalog | Configure in `STARTER_CHAT_MCP_CONFIG` (stdio or HTTP) |
| Best for | In-process logic, strict contracts | HTTP services, vibe-coded capabilities | Existing tool servers (yours or third-party / public ecosystem) |

## Skills bridge

**How loading works:**

1. At server start, the starter reads `STARTER_CHAT_SKILLS_DIR` (a `SkillRegistry`) and/or `STARTER_CHAT_SKILL_CATALOG_URL` (`HttpSkillSource`).
2. Each skill's `SKILL.md` is rendered: `{{NAME}}` placeholders are substituted from `STARTER_CHAT_SKILL_VAR_*` env vars (e.g. `STARTER_CHAT_SKILL_VAR_XLSX_AGENT_URL=http://localhost:3012`).
3. The rendered markdown is concatenated into one system prompt and prepended to every `/api/chat` request.
4. URL-shaped values from the render context are auto-added to the `http_request` allow-list, so the model can call the endpoints described in the skill without further config.

**Try it locally** — load the bundled skills (`spreadsheets`, `presentations`, etc.) and point them at the running pptx/xlsx agents:

```bash
# .env
STARTER_CHAT_SKILLS_DIR=../../packages/skills/templates
STARTER_CHAT_SKILL_VAR_XLSX_AGENT_URL=http://localhost:3012
STARTER_CHAT_SKILL_VAR_PPTX_AGENT_URL=http://localhost:3009
STARTER_CHAT_SKILL_VAR_AGENT_API_KEY=your-key
STARTER_CHAT_SKILL_VAR_AGENT_SLUG=starter-chat
```

`/api/health` reports the loaded skills and the effective `http_request` allow-list so you can verify what the agent actually sees.

**Security note:** `http_request` refuses any host that isn't on the allow-list. Empty list = no calls allowed. The auto-derivation from skill URL placeholders means installing a skill effectively grants permission to call the URLs that skill names — review skills before installing them, especially from remote catalogs.

## MCP client

`starter-chat` connects to external [MCP](https://modelcontextprotocol.io) servers and exposes their tools to the agent. Use this to plug in tools you didn't write — internal services that already speak MCP, or anything from the public ecosystem (filesystem, GitHub, Slack, Postgres, etc.).

**Config** — point `STARTER_CHAT_MCP_CONFIG` at a JSON file using the same `mcpServers` shape Claude Desktop uses:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/agent-workspace"]
    },
    "internal-api": {
      "url": "https://mcp.internal/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

- `command` → stdio transport (server runs as a child process).
- `url` → Streamable HTTP transport.

**Naming.** Each MCP tool surfaces as `<server>__<tool>` (double underscore separator — OpenAI's tool-name regex disallows `.` and `:`). So the filesystem server's `read_file` becomes `filesystem__read_file`.

**Lifecycle.** Servers are connected at startup. If a server fails to start, its error is recorded in `/api/health` (`mcp[].error`) and the rest of the bootstrap continues. There's no auto-reconnect — if a server dies mid-session, restart the starter. SIGINT / SIGTERM trigger a clean disconnect.

**Schema translation.** MCP tools provide JSON Schema for their inputs, which maps 1:1 to the OpenAI tools API. No translation layer needed.

**Out of scope** for this starter (not implemented; add if you need them): MCP **resources**, **prompts**, **sampling**, server-side **notifications**, **OAuth** for HTTP transport. The SDK supports them; this starter just doesn't wire them up by default.

### Adding a tool

Drop a file in `src/tools/`, export a `ToolDefinition`, and add it to the array in `src/tools/index.ts`:

```ts
import type { ToolDefinition } from './types.js';

export const myTool: ToolDefinition<{ url: string }> = {
  name: 'fetch_url',
  description: 'Fetch a URL and return its text body.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
    additionalProperties: false,
  },
  async execute(args) {
    const resp = await fetch(args.url);
    return { status: resp.status, body: (await resp.text()).slice(0, 4000) };
  },
};
```

Register dependencies your tool needs (queues, clients) in `ToolContext` and pass them in from `src/index.ts` at startup.

### Approvals

`propose_action` enqueues into an `InMemoryApprovalStore` owned by the running process — proposals don't survive restart. Suitable for a local demo. To wire a persistent store or a real dispatcher (email, Slack, webhook), implement `ApprovalStore` / `ApprovalDispatcher` from `@teamsuzie/approvals` and pass them to `new ApprovalQueue(...)` in `src/index.ts`.

The two review endpoints are intentionally minimal — list and review-by-id. Build your own UI on top, or point at the admin app.

## Architecture

The agent-loop core — `runChatTurn`, the skills loader, the MCP client, and the built-in tools — lives in the `@teamsuzie/agent-loop` workspace package, shared with [`starter-chat-vercel`](../starter-chat-vercel). This starter is the Express + Vite + React shell wrapping it.

If you change the loop, change it in `packages/agent-loop` and rebuild — both starters pick it up.

## Tests

```bash
pnpm --filter @teamsuzie/agent-loop test
```

The full test suite (tool-use loop, skills bridge, MCP client) lives in `@teamsuzie/agent-loop`:
- `tool-loop.test.ts` — tool-use loop end-to-end with stubbed model + vector-db.
- `skills-bridge.test.ts` — `http_request` allow-list, skill loader (filesystem rendering + URL host derivation), and the bridge end-to-end (skill describes endpoint → model emits `http_request` → dispatch round-trips).
- `mcp.test.ts` — config parsing (stdio + HTTP entries, conflict / invalid-name detection) and an in-memory MCP server end-to-end using `InMemoryTransport.createLinkedPair()` from the SDK.

## Why this app exists

The simplest generic starter template in the repo, with a real tool-use loop so "agent that calls services" works out of the box. Copy, rename, and adapt — the tool-use spine is yours to extend with whatever services your app needs (pptx-agent, xlsx-agent, your own APIs, etc.).
