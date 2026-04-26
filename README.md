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

Three templates live in `apps/starters/`. Copy one, rename it, and make it yours.

| If you want… | Use this starter | Notes |
|---|---|---|
| A chat app on **any OpenAI-compatible backend** (OpenAI, Anthropic via proxy, local models, our `llm-proxy`) | [`starter-chat`](apps/starters/starter-chat) | Simplest path. Tool-use loop runs in the starter's own backend — no second runtime needed. |
| A chat app on an **OpenClaw agent runtime** (server-side session continuity, runtime-managed tool calls, addressable agent identity) | [`starter-chat-openclaw`](apps/starters/starter-chat-openclaw) | Pick this when you want the agent loop owned by [OpenClaw](https://github.com/openclaw) instead of by your app. |
| An **internal tool / ops console** (Postgres-backed tables, auth-guarded pages, approval-gated mutations) | [`starter-ops-console`](apps/starters/starter-ops-console) | Pick this when your app is mostly a tool. Destructive actions are routed through the approval queue by default. Add a chat surface yourself if you want one. |

All three are small Express + React apps. They're meant to be copied and extended.

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

## What Team Suzie gives you, out of the box

So you don't rebuild any of this:

- **Auth** — multi-tenant sessions for browsers plus optional bearer tokens for app clients (orgs, users, agents) so your app is shippable to more than one customer on day one.
- **LLM proxy** — one endpoint, many providers, per-agent usage tracking.
- **Skill runtime** — installable capabilities you (or your assistant) drop into an agent's workspace. Composable; no monolithic tool registry.
- **Approval queue** — a primitive for "agent proposes, human approves." Pluggable dispatchers (email, Slack, webhooks, your call).
- **Scoped knowledge bases** — vector search (Milvus) + graph (Neo4j) with per-agent / per-org / global scopes.
- **Admin control plane** — a full operator UI: agents, skills, approvals, text artifacts, bearer tokens, runtime config, and an audit-backed activity feed. Every mutation writes an `AuditLog` row and is covered by an integration test suite.
- **Chat starters** — the three templates above, already wired for streaming and session handling. `starter-chat` ships a working tool-use loop with two demo tools (`vector_search`, `propose_action`) — drop new tool files in `src/tools/` to extend.

You'll use some of these; you won't need to write any of them.

---

## Examples — 10 starter prompts

Copy any prompt below into your coding assistant inside this repo, then edit the specifics. Each one is grounded in a real starter and exercises the pillars listed beside it.

> **What the starters include vs. what your assistant builds.** The starters give you a complete chat shell (streaming, sessions, UI), the tool-use loop in `starter-chat`, and approval-queue integration in `starter-ops-console`. Anything that calls a *specific* service — vector-db, graph-db, pptx-agent, xlsx-agent, an external API — is your assistant's job to wire up as a tool or a backend route. That's by design: the starters are an honest baseline; the pillars are servers; the assistant glues them together for *your* use case.

#### 1. Customer-support chatbot &nbsp;·&nbsp; *starter-chat · KB · approval*

```
Build a customer-support chatbot using starter-chat. Load my pricing,
refund, and shipping policies into the scoped knowledge base. When the
bot can't answer confidently, route a "human follow-up" action through
the approval queue. Test the golden path locally before anything else.
```

#### 2. Sales-research agent &nbsp;·&nbsp; *starter-chat-openclaw · approval · LLM proxy*

```
Turn starter-chat-openclaw into a sales-research agent. Given a company
name, it pulls basic firmographics, drafts a personalized outreach
email, and routes every outbound email through the approval queue —
nothing sends without my OK. Use the LLM proxy so I can see token
usage per session.
```

#### 3. Meeting-notes assistant &nbsp;·&nbsp; *starter-chat · vector + graph KB*

```
Build a meeting-notes assistant on starter-chat. I paste a transcript;
it produces an action-item summary and saves transcript + summary into
the scoped knowledge base. Later, I should be able to ask "what did we
decide about X last month?" and get a grounded answer with citations.
```

#### 4. Internal HR helpdesk &nbsp;·&nbsp; *starter-chat · KB · approval*

```
Make an internal HR assistant on starter-chat. It answers policy
questions from a knowledge base I'll populate (handbook, benefits,
PTO rules). It can also file time-off requests — but every request
must go through the approval queue before it's recorded.
```

#### 5. PR review bot &nbsp;·&nbsp; *starter-chat-openclaw · approval*

```
Build a PR review bot using starter-chat-openclaw. Given a GitHub PR
URL, it fetches the diff, summarizes intent, flags risks (security,
perf, missing tests), and proposes review comments. Posting the
comments to GitHub goes through the approval queue — never auto-post.
```

#### 6. Recruiter pipeline tool &nbsp;·&nbsp; *starter-ops-console · approval*

```
Build a recruiter pipeline tool from starter-ops-console. Page 1: a
candidates table backed by Postgres (name, role, stage, last contact).
Page 2: a candidate detail view with an agent drawer that drafts
outreach emails. Sending emails goes through the approval queue.
```

#### 7. SQL analytics assistant &nbsp;·&nbsp; *starter-ops-console · approval gating*

```
Build a SQL analytics assistant on starter-ops-console for a Postgres
DB I'll connect. SELECT queries run directly. Anything that mutates
data (INSERT/UPDATE/DELETE/DDL) must go through the approval queue
with the SQL diff visible to the approver.
```

#### 8. Document research agent &nbsp;·&nbsp; *starter-chat · vector + graph KB*

```
Build a research agent on starter-chat. I'll upload a folder of PDFs
(papers, internal docs). Index them into the vector KB and extract
entity relationships into the graph KB. The agent answers questions
using both, and shows which docs and which relationships it used.
```

#### 9. Slide-deck generator &nbsp;·&nbsp; *starter-chat · pptx-agent service · tool use*

```
Build a slide-deck generator on starter-chat. I describe a deck
(audience, key points); it drafts an outline, lets me iterate, and
once I sign off, generates a .pptx via the pptx-agent service
(running on :3009).

Wire pptx-agent in as a tool on starter-chat's tool-use loop —
pptx-agent is a separate HTTP service, not built into the starter.
```

#### 10. Spreadsheet financial analyst &nbsp;·&nbsp; *starter-chat · xlsx-agent service · tool use · LLM proxy*

```
Build a financial-analysis assistant on starter-chat. I upload a CSV
of transactions or a P&L; it answers questions about it and, on
request, produces a formatted .xlsx with charts via the xlsx-agent
service (running on :3012). Track LLM usage per session through the
proxy.

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
| `starter-chat` | 16311 | Generic full-stack chat starter |
| `starter-chat-openclaw` | 14311 | OpenClaw-oriented chat starter |
| `starter-ops-console` | 18311 | Internal-tool / ops-console starter with approval-gated destructive actions |

---

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
