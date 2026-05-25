# Architecture

## The thesis

Most agent frameworks stop at the loop: prompt → tools → response. That's enough for demos but not for running agents inside organizations, where you need answers to questions the loop doesn't address:

- Who is this agent allowed to act on behalf of?
- What skills does it have right now, and who granted them?
- Which of its proposed actions require human approval?
- What knowledge is private to this agent, shared with its team, or public?
- How do I change any of this without redeploying?

Team Suzie is the layer that answers those questions. It sits **between** your agent runtime and the organization it serves.

## Layered model

```
┌──────────────────────────────────────────────────────────────┐
│                     Agent runtime                             │
│   (OpenClaw today; LangGraph / CrewAI / custom as adapters)   │
└──────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Skill runtime │   │ Approval queue   │   │ Knowledge bases  │
│               │   │                  │   │                  │
│ discovery,    │   │ state machine,   │   │ vector (Milvus)  │
│ install,      │   │ human review,    │   │ + graph (Neo4j)  │
│ template      │   │ dispatch hooks   │   │ with scope       │
│ injection,    │   │                  │   │ hierarchy        │
│ workspace sync│   │                  │   │                  │
└───────────────┘   └──────────────────┘   └──────────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────────┐
        │          Multi-tenant substrate           │
        │                                           │
        │  auth (org → user → agent)                │
        │  config inheritance (agent → org → global)│
        │  LLM proxy with usage tracking            │
        └──────────────────────────────────────────┘
```

## The scope model

Every piece of state — knowledge, config, skills, approvals — is tagged with:

```typescript
scope: 'global' | 'org' | 'agent'
scope_id: string | null  // UUID; null when scope='global'
```

When an agent reads, the query walks the hierarchy:

```
agent's own scope → agent's org scope → global scope
```

First match wins for single-value config. For knowledge, results from all three are merged and re-ranked. This is the one-line mental model you need to carry through the rest of the code.

## The five pillars, concretely

### 1. Multi-tenant substrate (`packages/shared-auth`, `apps/platform/auth`)

- **Organization** — primary unit of tenancy. Two flavours share one table: *human orgs* (team of people plus their agents) and *agent orgs* (autonomous agent team with a human "board member" overseeing them).
- **User** — authenticates with email, belongs to one human org.
- **Agent** — belongs to exactly one org, authenticates with an API key.
- **AgentProfile** — template for creating agents; same profile can be instantiated in different orgs.

Browser clients use cookie-based sessions with CSRF; app clients can use bearer access tokens; agents use bearer API keys.

### 2. Skill runtime (`packages/skills`)

A **skill** is a named, versioned, installable capability. Each skill is a directory containing:

- `SKILL.md` — the instructions the agent reads.
- Optional support files (examples, schemas, prompts).

Skills are installed to an agent's *workspace* — a filesystem view the agent reads from when it boots. Installation is just a template render + file sync; no code is executed at install time. That keeps the surface area predictable and auditable.

The runtime provides:
- **Discovery** — list available skills (locally shipped + community catalog).
- **Source adapters** — normalize local folders, community catalogs, and hosted catalogs behind one `SkillSource` interface.
- **Install / uninstall** — atomic workspace updates.
- **Install policy hooks** — callers can allow, deny, or redirect an install before files are fetched or applied.
- **Template injection** — fills skill templates with agent-scoped config.
- **Workspace sync** — pushes changes into running agent containers (or notifies them).

The runtime does **not** decide whether an agent is *allowed* to install a given skill. That's an entitlement question and lives outside OSS (in hosted Team Suzie).

The OSS default install policy is permissive: if a skill source returns a bundle,
the runtime can install it. Hosted Team Suzie replaces that policy with an
entitlement-backed implementation and may expose a paid hosted source. The
important boundary is that the open runtime understands source metadata and
install decisions, but not Stripe, invoices, credits, or commercial account state.

```text
OSS skill runtime
  SkillSource        -> list/fetch skill bundles
  SkillInstallPolicy -> allow/deny/redirect install
  SkillTarget        -> write rendered files to workspace

Hosted Team Suzie
  billing account -> payment status
  entitlement service -> install/run decisions
  hosted catalog -> signed paid/free skill bundles
  managed APIs -> runtime enforcement for premium services
```

Paid skills should therefore be modeled as **hosted skill sources plus hosted
entitlements**, not as billing-aware OSS templates. A self-hosted operator can
configure a remote source, but the remote source decides what bundles it will
serve to that caller. For premium managed services, hosted APIs should also
check entitlement at execution time; install-time checks alone cannot prevent a
downloaded `SKILL.md` from being copied.

The repository includes `apps/examples/skill-catalog-host`, a tiny external
catalog that serves `GET /skills` and `GET /skills/:slug`. It proves the remote
source contract without adding billing simulation to OSS.

### 3. Approval queue (`packages/approvals`)

A generic state machine for **proposed actions that need a human before they dispatch**:

```
pending → approved → dispatched
        → rejected
        → failed
```

Reviewers can approve, reject, or approve with an edited payload. Edited payloads
replace the proposed payload before dispatch; they are part of `review()`, not a
separate durable state.

The v1 package ships the generic queue, state machine, dispatcher registry, and
`InMemoryApprovalStore`. The admin app and starters expose propose/review
endpoints and inbox UIs; `starter-ops-console` demonstrates a real gated delete
flow that dispatches after approval. Pending approvals are not durable with the
default store — they reset when the owning process restarts.

Production apps should replace `InMemoryApprovalStore` with their own
`ApprovalStore` implementation (Postgres, Redis/KV, SQLite, etc.) and register
dispatchers for each action type they want to execute. A first-party durable
Postgres store and async worker pattern are tracked in [ROADMAP.md](ROADMAP.md).

### 4. Scoped knowledge (`apps/platform/vector-db`, `apps/platform/graph-db`, `packages/db-client`)

Two services, same shape:

- **`vector-db`** — REST API over Milvus. Documents are embedded and stored with a scope tag. Queries accept a list of scopes to search.
- **`graph-db`** — REST API over Neo4j. Entities and relationships carry scope tags; Cypher queries are parameterized against scope lists.

`@teamsuzie/db-client` is the typed client. You rarely talk to the DB services directly.

### 5. LLM proxy (`apps/platform/llm-proxy`)

All LLM calls go through here. The proxy:

- Routes to the configured provider (OpenAI, Anthropic, others via adapters).
- Records token usage per agent / org (Redis-backed usage-tracker).
- Handles prompt caching where supported.

This is the chokepoint that makes per-agent / per-org cost visibility tractable.

## What's *not* in the OSS core

Explicit non-goals (these live in the commercial product):

- **Billing.** No Stripe integration, no invoices, no credits, no BYOK management.
- **Entitlements.** The OSS skill runtime exposes an install-policy hook, but ships no commercial entitlement engine. Install is allowed by default.
- **Managed connectors.** OAuth adapters with hosted credentials for Gmail, Outlook, Jira, etc. OSS ships the interfaces; bring your own OAuth app.
- **Deployment orchestration.** Kubernetes, staging/prod infra, customer onboarding — those are hosted ops concerns.

The seam between OSS and hosted is intentional. If you're reading this and wondering whether a feature belongs here, the test is: *does this make the business-agent layer more useful for self-hosters, or does it make the commercial service more sellable?* The first belongs; the second does not.

## Further reading

- [QUICKSTART.md](QUICKSTART.md) — get it running locally.
- [COMPOSITION.md](COMPOSITION.md) — how an agent build is composed from JSON config, upstream code, and per-build extensions. Read this before deciding where a new capability lives.
- [EXTENSION_MODEL.md](EXTENSION_MODEL.md) — how to write skills, approval dispatchers, LLM provider adapters.
- [ROADMAP.md](ROADMAP.md) — what's next.
