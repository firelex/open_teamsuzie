# Team Suzie

**Ship an agentic app this afternoon. Bring a coding assistant; Team Suzie brings the scaffolding.**

You're a product expert, a domain expert, a founder — someone who knows exactly what the agent should *do* but doesn't want to spend two weeks wiring up auth, chat UIs, approval flows, and knowledge bases before you get there. This repo is for you. Clone it, point your coding assistant at it, and describe what you want to build.

> ### Want it hosted? → [**teamsuzie.com**](https://teamsuzie.com)
>
> The hosted product is a **multi-agent marketplace built on the exact components in this repo** — same `@teamsuzie/*` packages, same skills runtime, same approval queue, same platform bridge. We add orchestration, managed providers, billing, and the operations work that an OSS repo doesn't (and shouldn't) ship. Use it when you'd rather not run the platform yourself.
>
> This repo is the open-source core — evolving quickly, usable today, and exactly what runs underneath the hosted version.

---

## Build your app in five steps

### 1. Install a coding assistant — and get an account for the model behind it

You'll describe your app in English; the assistant does the wiring. The assistant is just a CLI — the *model* behind it is what costs money. Pick one row:

| Assistant | What it is | What you sign up for |
|---|---|---|
| [Claude Code](https://claude.com/claude-code) | Anthropic's CLI; runs in terminal + IDE plugins | A [Claude Pro or Max plan](https://claude.com/pricing) (flat monthly, usage included — recommended) **or** an [Anthropic API key](https://console.anthropic.com) (pay per token) |
| [Codex](https://github.com/openai/codex) | OpenAI's coding CLI | A [ChatGPT Plus/Pro plan](https://chatgpt.com/pricing) **or** an [OpenAI API key](https://platform.openai.com) |
| [OpenCode](https://opencode.ai) | Open-source, provider-agnostic | An API key from [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com), or any [OpenRouter](https://openrouter.ai) provider |

Install your pick, sign in, and confirm `claude`, `codex`, or `opencode` runs in your terminal. **You'll use the same one for everything below.**

> **First time?** Start with Claude Code on a Pro plan. Flat monthly bill, no surprise per-token charges, and the model is strong on this exact stack.

### 2. Install local prerequisites and clone the repo

You need three things on your machine before your assistant can do anything useful:

- **[Node.js 22+](https://nodejs.org)** plus **`pnpm`** — install pnpm with `npm install -g pnpm` if you don't have it.
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** — the local stack runs Postgres and Redis, plus (optionally) Milvus and Neo4j in containers. **Open Docker Desktop and make sure it's running.** If you run the heavy vector/graph engines, give Docker ≥6 GB memory in *Settings → Resources* — Milvus won't start otherwise. A single-Postgres "lite" profile skips Milvus and Neo4j entirely (see [Storage backends](#storage-backends)).
- **Git**.

Then:

```bash
git clone https://github.com/firelex/open_teamsuzie
cd open_teamsuzie
pnpm install
```

No need to read the code — your assistant will.

### 3. Pick a starter template

The starters live in `apps/starters/`. Each is meant to be **copied, renamed, and extended** — pick the one whose shape is closest to what you're building. They fall into three families.

#### Chat starters — a conversational agent in front of a model

| Starter | Stack · ports | Use it when |
|---|---|---|
| [`starter-chat`](apps/starters/starter-chat) | Express + Vite + React · `16311` / `17276` | You want the simplest path. The tool-use loop runs in the starter's own backend — three built-in tools (`vector_search`, `propose_action`, `http_request`), a skills bridge, and an MCP client. No second runtime needed. |
| [`starter-chat-vercel`](apps/starters/starter-chat-vercel) | Next.js 15 / App Router · `19311` | You want the same chat app deployable to Vercel. Same tool-use loop and skills bridge, with serverless-honest constraints (HTTP-only MCP, no filesystem skill catalog, in-memory approvals). Its README spells out what's not supported. |
| [`starter-chat-openclaw`](apps/starters/starter-chat-openclaw) | Express + Vite + React · `14311` / `15276` | You want the agent loop owned by an [OpenClaw](https://github.com/openclaw) runtime instead of by your app — server-side session continuity, runtime-managed tool calls, addressable agent identity. The starter is a thin transport; point `STARTER_CHAT_AGENT_BASE_URL` at your OpenClaw instance. |

#### Marketplace-agent starters — build your own agent that plugs into a Team Suzie platform

These fork `starter-chat` and layer on `@teamsuzie/platform-bridge`: marketplace registration on boot, a webhook router at `/api/webhook/mothership`, and a platform-token auth gate. Pick one when you want your agent to **show up in a Team Suzie platform's marketplace** (hosted, or another OSS instance). See [The marketplace pattern](#the-marketplace-pattern) below.

| Starter | Use it when |
|---|---|
| [`starter-external-agent`](apps/starters/starter-external-agent) | The neutral base. Fork this for a marketplace agent with your own theme. Ports `16311` / `17276`. |
| [`starter-external-agent-omnibus`](apps/starters/starter-external-agent-omnibus) | You want everything configured through `agent.json` + sibling files (personas, workflows, tools). This is the canonical seed SuzieCode generates from. |
| `…-atelier` · `…-console` · `…-counsel` · `…-glasshouse` · `…-suziecode` · `…-teamsuzie` | You want to start from a pre-themed skin — editorial serif, terminal phosphor, law-office modernist, refined ops, developer graphite, or the electric-violet Team Suzie surface. Same platform-bridge wiring, different visual identity. |

#### Workspace & internal-tool starters — an app that's mostly a tool

| Starter | Stack · ports | Use it when |
|---|---|---|
| [`starter-ops-console`](apps/starters/starter-ops-console) | Express + Vite + React + Postgres · `18311` / `18276` | Your app is an internal tool / ops console — Postgres-backed tables, auth-guarded pages, CSV export. Destructive actions route through the approval queue by default. Add a chat surface yourself if you want one. |
| [`starter-workspace-app`](apps/starters/starter-workspace-app) | Express + Vite + React + OIDC + Postgres · `5211` / `5273` | You want a generic, information-architecture-driven **workspace** app: an auth gate over the whole app, a canonical shell, five reusable screen patterns (collection / record / guided-run / deliverable-review / config-editor), a global approval gate, and multi-tenant Postgres. Zero domain vocabulary — it's the Stage-0 scaffold a build harness stamps and then wires per project. |
| [`starter-department-agent`](apps/starters/starter-department-agent) | Vite + React 19 + Tailwind 4 · `5173` | You want just the **design + shell** baseline — the shared `@teamsuzie/ui` + `@teamsuzie/theme` identity, neutral routes, no server yet. Add your own backend and auth alongside it. |

> **Not sure?** Start with `starter-chat` to feel the tool-use loop, or `starter-workspace-app` if your app is more dashboard than dialogue.

### 4. Pick a backend

You have two options — your assistant can set either one up. Start with standalone if you're unsure; moving to OpenClaw later is mostly a config swap.

#### Option A — Standalone *(default)*

Run Team Suzie's own services (`auth`, `llm-proxy`, `vector-db`, `graph-db`) directly from this repo. Chat and workspace starters talk to any OpenAI-compatible provider (OpenAI, Anthropic, a local model, or our `llm-proxy`). Tool use lives in your starter — `starter-chat` handles the tool-call loop in its own backend, so you don't need a second runtime to use vector search, the approval queue, or any HTTP service.

The vector and graph stores each ship two interchangeable backends: the default heavy engines (Milvus + Neo4j) or a single-Postgres **lite** profile (`pgvector` + a Postgres graph). Application code only ever talks to the REST contract, so the choice is an env var — see [Storage backends](#storage-backends).

Tell your assistant: *"set up the standalone backend from the README quickstart and start starter-chat. Its tool-use loop already exposes `vector_search` and `propose_action` — extend with whatever else my app needs."*

#### Option B — On OpenClaw

[OpenClaw](https://github.com/openclaw) is a separate open-source agent runtime. You install it, run it, and point `STARTER_CHAT_AGENT_BASE_URL` (in `starter-chat-openclaw`) at it. The runtime owns the agent loop — multi-step reasoning, tool registration, session continuity (`x-openclaw-session-key`), addressable agent identity (`openclaw/<agentId>`).

> **Heads up:** OpenClaw is *not* installed by this repo. You (or your assistant) clone the OpenClaw runtime separately, start it, and pass its base URL to the starter. The starter is just a thin transport.

**Use OpenClaw when** you want a real server-managed agent loop — persistent agent memory across sessions, multi-step tool orchestration handled by the runtime, deployable agents as first-class objects — without your starter implementing any of that.

**Skip OpenClaw when** you just want a chat UI in front of a model, you're prototyping, or you'd rather control the tool loop in your own backend (which `starter-chat` supports — see its README).

Tell your assistant: *"clone the OpenClaw runtime, start it locally, then wire `starter-chat-openclaw` to it."*

### 5. Prompt your assistant

Open the repo in your coding assistant — `cd` into the repo, then run `claude`, `codex`, or `opencode` — and describe what you want. The assistant will read the repo, ask what it needs (API keys, policies, branding), spin up the backend, and build from there.

**Need ideas?** Jump to [Examples](#examples--10-starter-prompts) below for 10 copy-pasteable starter prompts — one per app idea, each grounded in a starter and the pillars it leans on.

**New to working with a coding assistant?** Read [Workflow](#workflow--how-to-vibe-code-well) below before your first long session. Five minutes there saves an afternoon of debugging.

---

## The marketplace pattern

Team Suzie isn't only "one app per repo." A **marketplace agent** is an app you own — its own users, its own LLM calls, its own tools and persistence — that also *registers with a Team Suzie platform* (the "mothership") so it shows up in that platform's marketplace and can receive proxied chats and direct messages.

[`@teamsuzie/platform-bridge`](packages/platform-bridge) is the OSS glue that makes this work, and it's what the `starter-external-agent-*` family is built on:

1. **Registration on boot** — `registerWithPlatform()` posts your agent's manifest to `${PLATFORM_URL}/api/marketplace/register`. The platform catalogs it and starts polling your `/api/health`. Idempotent; guarded by `PLATFORM_URL` so local dev without a platform just skips it.
2. **Platform-token auth** — when the mothership proxies a user's chat to your agent, it sends `X-Platform-Token` plus a context block. Bridge middleware validates the token and synthesizes a session, so your normal auth lets the request through. Your end-user auth stays yours.
3. **Webhook router** — mounted at `/api/webhook/mothership`, it handles `install`, `uninstall`, `dm`, and `ping` events from the platform.

The bridge is **fully open source** — a self-hosted agent can register with the hosted platform *or* with another OSS instance. What stays out of this repo (per [AGENTS.md](AGENTS.md)) is the platform side of billing, entitlements, and managed orchestration. `suzielaw` is the reference vertical built on this pattern; SuzieCode generates new agents from `starter-external-agent-omnibus`.

---

## Building your app in a separate repo

The starters live inside this monorepo for convenience, but most real apps want their own repo: their own commit history, their own deployment, their own CI. Team Suzie supports that pattern out of the box — keep this repo as the platform layer and put your app code in a sibling repo that consumes the packages.

**Layout.** Clone Team Suzie next to your app:

```
~/code/
  open_teamsuzie/   # this repo, kept clean
  my-app/           # your app, separate git repo
```

**`my-app/pnpm-workspace.yaml`** declares one or more local apps:

```yaml
packages:
  - apps/*
```

**`my-app/apps/web/package.json`** consumes Team Suzie packages from the sibling clone via `link:`:

```json
{
  "name": "my-app-web",
  "dependencies": {
    "@teamsuzie/ui": "link:../../../open_teamsuzie/packages/ui",
    "@teamsuzie/agent-loop": "link:../../../open_teamsuzie/packages/agent-loop",
    "@teamsuzie/approvals": "link:../../../open_teamsuzie/packages/approvals"
  }
}
```

**Bootstrap the app.** Copy a starter into your repo as a starting point (`cp -R ../open_teamsuzie/apps/starters/starter-chat apps/web`), swap in the `link:` references above, then `pnpm install`.

**Why this works.** The `link:` protocol points at a directory — pnpm symlinks it, so changes in `open_teamsuzie/packages/*` show up immediately in your app. When you upgrade Team Suzie (`git pull` in the sibling clone), your app picks up the new code without a publish step. Your app's repo only contains code that is genuinely yours.

**When to use a published version instead.** If you're shipping the app to teammates who shouldn't need a local clone of Team Suzie, replace the `link:` references with a published version — either the npm registry, a GitHub Packages registry, or your own private registry. The package boundaries don't change.

---

## Reference apps built on Team Suzie

Working examples of the sibling-repo pattern in the wild. Clone alongside Team Suzie to study the wiring, or fork to bootstrap a vertical app of your own.

| App | Vertical | What it shows |
|---|---|---|
| **[Suzie Law](https://github.com/firelex/suzielaw)** | Legal AI (an OSS alternative to Harvey) | The marketplace-agent pattern end to end: domain chat assistant ("Counsel"), prompt + workflow library by practice area, agentic DOCX drafting with a live read-only artifact panel, document Q&A via `markitdown-agent`, `@teamsuzie/platform-bridge` registration, model picker in Settings. |
| **SuzieCode** | Agent generator | Generates new marketplace agents from `starter-external-agent-omnibus` — everything driven by `agent.json` and sibling config (personas, workflows, tools). |

Building one of your own? Add it here via PR — the bar is "honest, runnable, and shows a non-trivial extension of the platform."

---

## What Team Suzie gives you, out of the box

So you don't rebuild any of this:

- **Auth** — multi-tenant sessions for browsers plus optional bearer tokens for app clients (orgs, users, agents), and an OIDC path (`starter-workspace-app`) that puts the whole app behind a login. Your app is shippable to more than one customer on day one.
- **LLM proxy + model gateway** — one endpoint, many providers, per-agent usage tracking. The shared [`@teamsuzie/models`](packages/models) gateway surfaces curated hosted models (Claude, GPT, Qwen) plus any reachable local runtime, reading provider keys from the environment; [`@teamsuzie/models-ui`](packages/models-ui) ships a **Models page** to pick, test, and persist a default model that workflows reuse.
- **Skill runtime** — installable capabilities you (or your assistant) drop into an agent's workspace as markdown templates. Composable; no monolithic tool registry. `starter-chat` loads skills into the system prompt at startup and dispatches the HTTP calls they describe via the built-in `http_request` tool — so you can ship new agent capabilities without writing TypeScript.
- **Approval queue** — a primitive for "agent proposes, human approves." Pluggable dispatchers (email, Slack, webhooks, your call). `starter-workspace-app` wires it as a global gate so every side-effecting screen confirms before acting.
- **Scoped knowledge bases** — vector search + graph with per-agent / per-org / global scopes. Run the heavy engines (Milvus + Neo4j) or the single-Postgres lite profile (`pgvector` + Postgres graph) — same REST contract either way.
- **Marketplace bridge** — [`@teamsuzie/platform-bridge`](packages/platform-bridge) registers a self-hosted agent with a Team Suzie platform and handles proxied chats, DMs, and lifecycle webhooks. See [The marketplace pattern](#the-marketplace-pattern).
- **Local SQLite plumbing** — `@teamsuzie/db-sqlite` wraps `better-sqlite3` with sane defaults (WAL, foreign keys on), idempotent migrations, a prepared-statement cache, and JSON-column helpers. Apps that need local persistence (saved prompts, session history, draft snapshots) write their schema and skip the plumbing. Production multi-tenant data still belongs in Postgres + `shared-auth`.
- **Document navigation + drafting** — `@teamsuzie/markdown-document`, `@teamsuzie/docx` (lossless OOXML round-trip), `@teamsuzie/docx-diff`, `@teamsuzie/pdf`, and the sibling `markitdown-agent` (Python: MarkItDown + pandoc). Upload a DOCX/PDF/PPTX; call `convert_to_markdown(file_id)` and the agent gets `get_outline` / `read_section` / `search_document`. Or `create_document` / `set_outline` / `write_section` / `export_to_docx` to draft a memo and ship a styled DOCX.
- **Admin control plane** — a full operator UI: agents, skills, approvals, text artifacts, bearer tokens, runtime config, and an audit-backed activity feed. Every mutation writes an `AuditLog` row and is covered by an integration test suite.
- **Capability services** — HTTP agents you wire in as tools: `pptx-agent` (PowerPoint), `xlsx-agent` (spreadsheets), `markitdown-agent` (document conversion), plus DOCX/PPTX template agents.

You'll use some of these; you won't need to write any of them.

---

## Examples — 10 starter prompts

Copy any prompt below into your coding assistant inside this repo, then edit the specifics. Each one is grounded in a real starter and exercises the pillars listed beside it.

> **What the starters include vs. what your assistant builds.** The starters give you a complete chat shell (streaming, sessions, UI), the tool-use loop in `starter-chat`, and approval-queue integration in `starter-ops-console`. Anything that calls a *specific* service — vector-db, graph-db, pptx-agent, xlsx-agent, an external API — is your assistant's job to wire up as a tool or a backend route. That's by design: the starters are an honest baseline; the pillars are servers; the assistant glues them together for *your* use case.

#### 1. Warranty triage copilot &nbsp;·&nbsp; *starter-chat · KB · approval*

```
Build a warranty triage copilot on starter-chat for a hardware company.
It should ask for product model, purchase date, symptoms, photos link,
and country. It answers policy questions from a scoped KB, classifies
the case as covered / not covered / needs human review, and drafts the
customer reply.

Never promise replacement or refund automatically. Any "approve claim"
or "deny claim" action must go through the approval queue with the
evidence visible. Add one happy-path test and one "missing purchase
date" edge case.
```

#### 2. Founder sales-desk agent &nbsp;·&nbsp; *starter-chat-openclaw · approval · LLM proxy*

```
Turn starter-chat-openclaw into a founder sales-desk agent. Given a
company URL, it builds a one-page account brief: what they sell, likely
buyer, relevant trigger, risks, and a first email in my voice. Store the
brief as a text artifact.

Do not send email. Propose a send action through the approval queue,
including subject, body, recipient, and the facts used. Use the LLM
proxy so token usage appears in admin activity.
```

#### 3. Board-meeting memory &nbsp;·&nbsp; *starter-chat · vector + graph KB*

```
Build a board-meeting memory app on starter-chat. I paste a transcript;
it extracts decisions, risks, owners, dates, and open questions. Save
the transcript chunks to the vector KB and the people/projects/decisions
relationships to the graph KB.

Later I should be able to ask "what did we decide about pricing?" or
"which risks has Sarah owned?" and get a grounded answer with citations
and relationship evidence. Add a tiny seeded transcript fixture.
```

#### 4. Policy desk with escalation &nbsp;·&nbsp; *starter-chat · KB · approval*

```
Make an internal policy desk on starter-chat for HR + finance questions.
Load handbook, expenses, travel, and PTO docs into the scoped KB. The
assistant must answer with the exact source section it relied on and say
"I don't know" if the KB doesn't cover it.

For expense exceptions and PTO requests, create an approval item instead
of recording anything directly. Include requester, policy section,
amount/dates, and rationale in the approval payload.
```

#### 5. Release-risk reviewer &nbsp;·&nbsp; *starter-chat-openclaw · approval*

```
Build a release-risk reviewer using starter-chat-openclaw. Given a
GitHub PR URL and target release date, it fetches the diff, summarizes
intent, flags security/perf/migration/test risks, and produces a
"ship / hold / needs owner" recommendation.

It may draft GitHub review comments, but posting comments must go
through the approval queue. Add a local fake-diff fixture so the review
logic can be tested without hitting GitHub.
```

#### 6. Candidate debrief console &nbsp;·&nbsp; *starter-ops-console · approval*

```
Build a candidate debrief console from starter-ops-console. Page 1 is a
candidate table backed by Postgres: role, stage, score, next step, last
contact. Page 2 shows interview notes, concerns, strengths, and a chat
drawer that drafts follow-up emails and structured interviewer summaries.

No candidate rejection or offer email can be sent directly. Route it
through the approval queue and show the exact message to the approver.
```

#### 7. Finance ops SQL copilot &nbsp;·&nbsp; *starter-ops-console · approval gating*

```
Build a finance ops SQL copilot on starter-ops-console for a Postgres DB
I'll connect. It should answer questions like "which invoices are 30+
days overdue?" and render results as a table with saved query history.

SELECT queries can run directly. INSERT/UPDATE/DELETE/DDL must become an
approval item with the SQL, expected row count, rollback SQL, and a plain
English explanation. Never execute mutations before approval.
```

#### 8. Contract red-flag desk &nbsp;·&nbsp; *starter-chat · vector + graph KB*

```
Build a contract red-flag desk on starter-chat. I paste contract text or
upload extracted text files. It identifies parties, dates, renewal terms,
termination rights, payment obligations, liability caps, assignment
limits, and unusual clauses.

Store clause chunks in the vector KB and party/obligation/date
relationships in the graph KB. It must label output as review support,
not legal advice, and cite the exact clauses it used.
```

#### 9. Investor update deck builder &nbsp;·&nbsp; *starter-chat · pptx-agent service · tool use*

```
Build an investor update deck builder on starter-chat. I paste monthly
metrics, wins, risks, asks, and narrative notes. The agent drafts a
7-slide outline: title, KPI snapshot, growth drivers, product progress,
customer proof, risks, asks.

Let me edit the outline in chat. Only after I approve the outline should
it call the pptx-agent service running on :3009 to generate the .pptx.

Wire pptx-agent in as a tool on starter-chat's tool-use loop —
pptx-agent is a separate HTTP service, not built into the starter.
```

#### 10. Cash runway analyst &nbsp;·&nbsp; *starter-chat · xlsx-agent service · tool use · LLM proxy*

```
Build a cash runway analyst on starter-chat. I upload or paste monthly
revenue, payroll, tools, contractors, and one-off expenses. It computes
burn, runway, biggest cost movers, and "what if we cut X?" scenarios.

On request, generate a formatted .xlsx with assumptions, monthly cash
balance, charts, and scenario tabs via xlsx-agent running on :3012.
Track LLM usage per session through the proxy.

Wire xlsx-agent in as a tool on starter-chat's tool-use loop —
xlsx-agent is a separate HTTP service, not built into the starter.
```

---

## Workflow — how to vibe-code well

A coding assistant doesn't replace good engineering habits; it accelerates them. The teams shipping fast on this repo follow these:

### 1. Prompt with intent, not just words
- State *what the app does*, *who uses it*, and *what it must never do*. Concrete examples beat adjectives. ("Don't send any email without approval" beats "be careful with emails.")
- Mention the starter and pillars by name (`starter-chat`, `approval queue`, `vector KB`) — your assistant has read this README and knows what they are.
- When something's off, paste the **exact error or the actual behavior**. "It's broken" gets a vague fix; the stack trace gets a real one.

### 2. Test the golden path early
- Ask the assistant to write integration tests *as it builds*, not at the end. The admin app's suite (`apps/platform/admin/src/__tests__`) is a good shape to copy.
- Run the app yourself before declaring victory. Type-checking and unit tests verify code, not features. Click through the happy path, then try one obvious edge case.

### 3. Refactor in passes
- After every two or three feature additions, prompt: *"refactor for clarity — same behavior, less code, no new abstractions."* Prune duplication before it becomes load-bearing.
- Don't let the assistant invent abstractions you didn't ask for. If you see helpers, wrappers, or "managers" you don't need, tell it to delete them.

### 4. Commit often, review diffs
- Commit after each working step. If a refactor goes sideways, `git diff` and `git reset` are faster than re-prompting from scratch.
- Skim every diff before accepting it. Vibe coding stops working when humans stop reading the code — that's when subtle bugs and unwanted "improvements" sneak in.

### 5. Use the admin UI as your debugger
The admin control plane at [http://localhost:3008](http://localhost:3008) shows you the live state of the system:
- **Approvals stuck?** Open the queue.
- **KB returning weird answers?** Inspect what's indexed.
- **Token spend climbing?** Check the usage feed.
- **Audit trail?** Every mutation is logged.

If your app is misbehaving, look there before you re-prompt.

### 6. Keep secrets out of prompts
- API keys, DB URLs, and tokens go in `.env`, never inline in prompts or chat history. Most assistants log conversations.
- If you paste one by accident, rotate it. Every provider's console has a one-click revoke.

---

## For platform engineers

If you're building the substrate rather than the product on top, the rest of this README is for you.

### The five pillars

1. **Multi-tenant by default.** Every piece of state — knowledge, config, skills, approvals — is scoped `global / org / agent`. An agent queries its own scope plus its org's, transparently.
2. **Skill runtime.** Skills are discoverable, installable, versioned capabilities shipped as templates (instructions + files) injected into an agent's workspace.
3. **Human-in-the-loop approvals.** Reusable approval queue with a pluggable dispatcher interface. Generic by design — no provider-specific code in the core.
4. **Scoped knowledge bases.** Vector + graph with the same scope model. One agent, three hierarchical knowledge sources, one query.
5. **Multi-tenant control plane.** Session auth with org/user/agent identity, scoped config inheritance, LLM proxy that attributes every token.

### Standalone backend quickstart

```bash
cp .env.example .env
pnpm docker:up        # postgres, redis, milvus, neo4j
pnpm dev:auth         # :3005
pnpm dev:llm-proxy    # :4000
pnpm dev:vector-db    # :3006
pnpm dev:graph-db     # :3007
pnpm dev:admin        # :3008 (API) · :5175 (Vite UI)
```

A `curl`-driven tour lives in [docs/QUICKSTART.md](docs/QUICKSTART.md). Full architecture in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Storage backends in [docs/BACKENDS.md](docs/BACKENDS.md). Extension model in [docs/EXTENSION_MODEL.md](docs/EXTENSION_MODEL.md). Roadmap in [docs/ROADMAP.md](docs/ROADMAP.md).

### Storage backends

Both the vector store and the graph store ship two interchangeable implementations, switchable per service via env var. Callers (`@teamsuzie/db-client`, the agent runtime, the admin UI) only ever talk to the REST contract, so nothing above the service changes.

| Service | Default (heavy) | Lite (single Postgres) | Switch |
|---|---|---|---|
| `vector-db` | `milvus` — Milvus standalone; best at scale (10M+ vectors), hybrid search | `pgvector` — Postgres + `pgvector`, HNSW index, cosine distance | `VECTOR_BACKEND=milvus\|pgvector` |
| `graph-db` | `neo4j` — full Cypher (`/v1/query/cypher`) | `pg` — Postgres `graph_nodes` + `graph_edges`, `pg_trgm` fuzzy search (no Cypher) | `GRAPH_BACKEND=neo4j\|pg` |

Pick the lite profile for small-to-medium projects on a single Postgres; stay on the heavy engines for large corpora or Cypher traversals. Details and trade-offs in [docs/BACKENDS.md](docs/BACKENDS.md).

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Your agent                        │
│   (in-process tool loop, OpenClaw, or marketplace)   │
└─────────────────────────────────────────────────────┘
           ▲                ▲               ▲
           │                │               │
  ┌────────┴────────┐  ┌────┴─────┐  ┌──────┴──────┐
  │   Skill runtime │  │ Approval │  │  Knowledge  │
  │   (packages/    │  │  queue   │  │   (vector   │
  │    skills)      │  │          │  │   + graph)  │
  └─────────────────┘  └──────────┘  └─────────────┘
           ▲                ▲               ▲
           └────────────────┴───────────────┘
                            │
         ┌──────────────────┴──────────────────┐
         │  Auth + config + LLM proxy + models  │
         │        (multi-tenant substrate)      │
         └──────────────────────────────────────┘
```

### Packages

The reusable core lives in `packages/*` — ~50 workspaces that downstream apps consume via `link:` or a published registry. The most load-bearing:

**Runtime & agent loop**

| Package | Purpose |
|---|---|
| `@teamsuzie/agent-runtime` | Manifest-driven agent shell — Express boot + React app the starters and generated agents boot from |
| `@teamsuzie/agent-loop` | Headless OpenAI-compatible tool-use loop with skills bridge + MCP client |
| `@teamsuzie/platform-bridge` | Marketplace registration, platform-token middleware, and webhook router for external agents |
| `@teamsuzie/agent-events` | Structured `AgentUpdate` / `AgentAction` types emitted by orchestration and rendered by presenters |

**Substrate & tenancy**

| Package | Purpose |
|---|---|
| `@teamsuzie/types` | Shared TypeScript types (scopes, agent context) |
| `@teamsuzie/shared-auth` | Multi-tenant auth models + middleware (org, user, agent) |
| `@teamsuzie/config-client` | Scoped config resolver |
| `@teamsuzie/crypto` | Zero-dependency AES-256-GCM + key-hash helpers |
| `@teamsuzie/usage-tracker` | Redis-backed LLM usage event publisher |
| `@teamsuzie/billing-stripe` | Stripe credit-balance billing for orgs (OSS interface) |

**Models & knowledge**

| Package | Purpose |
|---|---|
| `@teamsuzie/models` | Shared model gateway — hosted (Anthropic/OpenAI/Qwen) + reachable local runtimes, keys from env |
| `@teamsuzie/models-ui` | The Models page — pick, test, and persist a default model |
| `@teamsuzie/model-settings` | Per-user overrides for the local-model registry |
| `@teamsuzie/kb` | Lightweight RAG KB — sqlite-vec + embeddings + agent-loop tool |
| `@teamsuzie/db-client` | Typed clients for the vector-db and graph-db services |

**Approvals, workflows & records**

| Package | Purpose |
|---|---|
| `@teamsuzie/approvals` | Human-in-the-loop approval queue with pluggable store + dispatchers |
| `@teamsuzie/workflows` · `@teamsuzie/pipelines` · `@teamsuzie/work-runs` | Workflows-as-data, stage-based pipelines, and generic work-run lifecycle |
| `@teamsuzie/reviews` · `@teamsuzie/grid-review` (`+ -rag`) | Tabular document review — rows are documents, columns are prompted questions, cells cite sources |
| `@teamsuzie/records` · `@teamsuzie/activity` · `@teamsuzie/events` | Structured records, append-only activity timeline, and a typed event bus + SSE |

**Documents**

| Package | Purpose |
|---|---|
| `@teamsuzie/markdown-document` | MarkdownDocument navigation/drafting primitive + agent-loop tools |
| `@teamsuzie/docx` · `@teamsuzie/docx-diff` · `@teamsuzie/pdf` · `@teamsuzie/xlsx` | Lossless OOXML round-trip, paragraph-level diff, DOCX→PDF, read-only xlsx AST |
| `@teamsuzie/document-conversion` · `@teamsuzie/citations` | markitdown facade + inline-citation wire format |
| `@teamsuzie/artifacts` · `@teamsuzie/files` · `@teamsuzie/document-versions` | Markdown artifacts, scoped upload/download router, immutable version chains |

**Workspaces & UI**

| Package | Purpose |
|---|---|
| `@teamsuzie/workspaces` · `@teamsuzie/matters` · `@teamsuzie/sharing` | Generic doc-container schema, the "matter" composition layer, and cross-subject membership |
| `@teamsuzie/chats` · `@teamsuzie/user-memory` · `@teamsuzie/personas` | Persisted chats, per-user long-lived memory, persona registry |
| `@teamsuzie/db-sqlite` · `@teamsuzie/jobs` · `@teamsuzie/email` | SQLite plumbing, async job queue, provider-agnostic email contracts |
| `@teamsuzie/skills` | Headless skill runtime — discovery, template rendering, pluggable target |
| `@teamsuzie/ui` · `@teamsuzie/theme` | Shared React component library and the CSS-only design tokens (Tailwind 4) |

Full list in `packages/*`; each package has its own README.

### Apps

```text
apps/platform  # core services and the admin control plane
apps/starters  # starter templates and demos
apps/agents    # capability services like pptx/xlsx/document generation
apps/examples  # small reference services for extension contracts
```

| App | Port | Purpose |
|---|---|---|
| `auth` | 3005 | Session-based multi-tenant auth (cookies, bearer tokens, OIDC) |
| `llm-proxy` | 4000 | LLM routing with per-agent usage tracking |
| `vector-db` | 3006 | Scoped vector search (Milvus or pgvector) |
| `graph-db` | 3007 | Scoped graph queries (Neo4j or Postgres) |
| `admin` | 3008 / 5175 | Operator control plane — agents, skills, approvals, artifacts, tokens, config, activity feed, browser chat console |
| `pptx-agent` | 3009 | LLM-powered PowerPoint generation |
| `xlsx-agent` | 3012 | LLM-powered spreadsheet generation (FastAPI) |
| `markitdown-agent` | 3013 | Document ↔ markdown conversion (FastAPI + pandoc) |
| `skill-catalog-host` | 3021 | Example external skill catalog for `HttpSkillSource` |
| `starter-chat` | 16311 / 17276 | Generic full-stack chat starter (Express + Vite + React) |
| `starter-chat-openclaw` | 14311 / 15276 | OpenClaw-oriented chat starter |
| `starter-chat-vercel` | 19311 | Same agent core, Next.js 15 / Vercel-deployable variant |
| `starter-external-agent` (+ variants) | 16311 / 17276 | Marketplace-agent base and pre-themed skins |
| `starter-ops-console` | 18311 / 18276 | Internal-tool / ops-console starter with approval-gated actions |
| `starter-workspace-app` | 5211 / 5273 | IA-driven multi-tenant workspace scaffold (OIDC + Postgres) |
| `starter-department-agent` | 5173 | Design + shell baseline (Vite + React 19, no server) |

---

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
