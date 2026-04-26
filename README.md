# Team Suzie

**Ship an agentic app this afternoon. Bring a coding assistant; Team Suzie brings the scaffolding.**

You're a product expert, a domain expert, a founder — someone who knows exactly what the agent should *do* but doesn't want to spend two weeks wiring up auth, chat UIs, approval flows, and knowledge bases before you get there. This repo is for you. Clone it, point your coding assistant at it, and describe what you want to build.

The hosted version lives at [teamsuzie.com](https://teamsuzie.com). This repo is the open-source core — evolving quickly, usable today.

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
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** — the local stack runs Postgres, Redis, Milvus, and Neo4j in containers. **Open Docker Desktop and make sure it's running.** Give it ≥6 GB memory in *Settings → Resources* — Milvus won't start otherwise.
- **Git**.

Then:

```bash
git clone https://github.com/firelex/teamsuzie
cd teamsuzie
pnpm install
```

No need to read the code — your assistant will.

### 3. Pick a starter template

Four templates live in `apps/starters/`. Copy one, rename it, and make it yours.

| If you want… | Use this starter | Notes |
|---|---|---|
| A chat app on **any OpenAI-compatible backend** (OpenAI, Anthropic via proxy, local models, our `llm-proxy`) | [`starter-chat`](apps/starters/starter-chat) | Simplest path. Tool-use loop runs in the starter's own backend — no second runtime needed. Express + Vite + React, runs locally. |
| The **same chat app, deployable to Vercel** | [`starter-chat-vercel`](apps/starters/starter-chat-vercel) | Next.js 15 / App Router. Same tool-use loop, skills bridge, and MCP client — but with serverless-honest constraints (no stdio MCP, no filesystem skill catalog, in-memory approvals reset on cold start). The starter's README spells out exactly what's not supported. |
| A chat app on an **OpenClaw agent runtime** (server-side session continuity, runtime-managed tool calls, addressable agent identity) | [`starter-chat-openclaw`](apps/starters/starter-chat-openclaw) | Pick this when you want the agent loop owned by [OpenClaw](https://github.com/openclaw) instead of by your app. |
| An **internal tool / ops console** (Postgres-backed tables, auth-guarded pages, approval-gated mutations) | [`starter-ops-console`](apps/starters/starter-ops-console) | Pick this when your app is mostly a tool. Destructive actions are routed through the approval queue by default. Add a chat surface yourself if you want one. |

`starter-chat`, `starter-chat-openclaw`, and `starter-ops-console` are Express + Vite + React. `starter-chat-vercel` is Next.js. All are meant to be copied and extended.

### 4. Pick a backend

You have two options — your assistant can set either one up. Start with standalone if you're unsure; moving to OpenClaw later is mostly a config swap.

#### Option A — Standalone *(default)*

Run Team Suzie's own services (`auth`, `llm-proxy`, `vector-db`, `graph-db`) directly from this repo. The chat starter talks to any OpenAI-compatible provider (OpenAI, Anthropic via proxy, a local model, or our `llm-proxy`). Tool use lives in your starter — `starter-chat` handles the tool-call loop in its own backend, so you don't need a second runtime to use vector search, the approval queue, or any HTTP service.

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

## Building your app in a separate repo

The starters live inside this monorepo for convenience, but most real apps want their own repo: their own commit history, their own deployment, their own CI. Team Suzie supports that pattern out of the box — keep this repo as the platform layer and put your app code in a sibling repo that consumes the packages.

**Layout.** Clone Team Suzie next to your app:

```
~/code/
  teamsuzie/        # this repo, kept clean
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
    "@teamsuzie/ui": "link:../../../teamsuzie/packages/ui",
    "@teamsuzie/agent-loop": "link:../../../teamsuzie/packages/agent-loop",
    "@teamsuzie/approvals": "link:../../../teamsuzie/packages/approvals"
  }
}
```

**Bootstrap the app.** Copy a starter into your repo as a starting point (`cp -R ../teamsuzie/apps/starters/starter-chat apps/web`), swap in the `link:` references above, then `pnpm install`.

**Why this works.** The `link:` protocol points at a directory — pnpm symlinks it, so changes in `teamsuzie/packages/*` show up immediately in your app. When you upgrade Team Suzie (`git pull` in the sibling clone), your app picks up the new code without a publish step. Your app's repo only contains code that is genuinely yours.

**When to use a published version instead.** If you're shipping the app to teammates who shouldn't need a local clone of Team Suzie, replace the `link:` references with a published version — either the npm registry, a GitHub Packages registry, or your own private registry. The package boundaries don't change.

---

## What Team Suzie gives you, out of the box

So you don't rebuild any of this:

- **Auth** — multi-tenant sessions for browsers plus optional bearer tokens for app clients (orgs, users, agents) so your app is shippable to more than one customer on day one.
- **LLM proxy** — one endpoint, many providers, per-agent usage tracking.
- **Skill runtime** — installable capabilities you (or your assistant) drop into an agent's workspace as markdown templates. Composable; no monolithic tool registry. `starter-chat` loads skills into the system prompt at startup and dispatches the HTTP calls they describe via the built-in `http_request` tool — so you can ship new agent capabilities without writing TypeScript.
- **Approval queue** — a primitive for "agent proposes, human approves." Pluggable dispatchers (email, Slack, webhooks, your call).
- **Scoped knowledge bases** — vector search (Milvus) + graph (Neo4j) with per-agent / per-org / global scopes.
- **Local SQLite plumbing** — `@teamsuzie/db-sqlite` wraps `better-sqlite3` with sane defaults (WAL, foreign keys on), idempotent migrations, a prepared-statement cache, and JSON-column helpers. Apps that need local persistence (saved prompts, session history, draft snapshots) write their schema and skip the plumbing. Production multi-tenant data still belongs in Postgres + `shared-auth`.
- **Admin control plane** — a full operator UI: agents, skills, approvals, text artifacts, bearer tokens, runtime config, and an audit-backed activity feed. Every mutation writes an `AuditLog` row and is covered by an integration test suite.
- **Chat starters** — the three templates above, already wired for streaming and session handling. `starter-chat` ships a working tool-use loop with three built-in tools (`vector_search`, `propose_action`, `http_request`), a skills bridge that pulls in markdown-defined capabilities from a local directory or remote catalog, and an [MCP](https://modelcontextprotocol.io) client that connects to external MCP servers (stdio + Streamable HTTP) and exposes their tools too. Three extension paths: typed tool for in-process / strict-schema work, skill for vibe-coded HTTP services, MCP for tool servers you didn't write.

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
```

A `curl`-driven tour lives in [docs/QUICKSTART.md](docs/QUICKSTART.md). Full architecture in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap in [docs/ROADMAP.md](docs/ROADMAP.md).

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Your agent                        │
│      (OpenClaw today; adapters planned for others)   │
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
              ┌─────────────┴─────────────┐
              │  Auth + config + LLM proxy │
              │   (multi-tenant substrate) │
              └────────────────────────────┘
```

### Packages

| Package | Purpose |
|---|---|
| `@teamsuzie/types` | Shared TypeScript types (scopes, agent context) |
| `@teamsuzie/shared-auth` | Multi-tenant auth models (org, user, agent) |
| `@teamsuzie/skills` | Headless skill runtime — discovery, template rendering, pluggable target |
| `@teamsuzie/approvals` | Approval queue state machine with pluggable store & dispatchers |
| `@teamsuzie/db-client` | Typed clients for vector-db and graph-db services |
| `@teamsuzie/usage-tracker` | Redis-backed LLM usage event publisher |
| `@teamsuzie/config-client` | Scoped config resolver |
| `@teamsuzie/ui` | Shared React component library |

### Apps

```text
apps/platform  # core services and the admin control plane
apps/starters  # starter templates and demos
apps/agents    # capability services like pptx/xlsx generation
apps/examples  # small reference services for extension contracts
```

| App | Port | Purpose |
|---|---|---|
| `auth` | 3005 | Session-based multi-tenant auth |
| `llm-proxy` | 4000 | LLM routing with usage tracking |
| `vector-db` | 3006 | Scoped Milvus vector search |
| `graph-db` | 3007 | Scoped Neo4j graph queries |
| `pptx-agent` | 3009 | LLM-powered PowerPoint generation |
| `xlsx-agent` | 3012 | LLM-powered spreadsheet generation |
| `admin` | 3008 | Operator control plane — agents, skills, approvals, artifacts, tokens, runtime config, activity feed, and the original browser chat console |
| `skill-catalog-host` | 3021 | Example external skill catalog for `HttpSkillSource` |
| `starter-chat` | 16311 | Generic full-stack chat starter (Express + Vite + React) |
| `starter-chat-vercel` | 19311 | Same agent core, Next.js 15 / Vercel-deployable variant |
| `starter-chat-openclaw` | 14311 | OpenClaw-oriented chat starter |
| `starter-ops-console` | 18311 | Internal-tool / ops-console starter with approval-gated destructive actions |

---

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
