# Team Suzie

**An open business operating layer for autonomous multi-agent systems.**

Agent runtimes give you execution. Team Suzie gives you the business context agents need to operate inside real organizations: skills, workspaces, approval queues, multi-tenant auth, and scoped knowledge bases. The proven integration today is [OpenClaw](https://github.com/openclaw); LangGraph, CrewAI, and other runtimes are target adapters on the roadmap.

> **Phase 1 (today — v0.1):** The five pillars ship as **runnable, tested TypeScript packages**. Ten packages and services build clean; 66 tests pass. What's not here yet: the admin UI, a first-party demo agent, and application-level integrations (email dispatcher, DB-backed approval store, first-party skills that talk to real APIs).
>
> **Phase 2+ (coming weeks — v0.2 through v0.4):** admin UI, reference dispatchers (email approvals, webhooks), first-party skills, demo agent, and durable storage for the approval queue. When all phases land, the OSS repo covers the core of what's running on [teamsuzie.com](https://teamsuzie.com) — minus the commercial layer (billing, paid-skill marketplace, managed OAuth, hosted orchestration), which stays in the hosted product. See [ROADMAP](docs/ROADMAP.md) for exact phasing.
>
> **Who Phase 1 is for today:** platform and infrastructure engineers who want to build on a multi-tenant agent substrate and are comfortable wiring their own applications on top. If you want a batteries-included agent product you can click through, come back at Phase 2 or use the hosted service.

## Why Team Suzie

Most agent frameworks answer *"how do I run a prompt loop with tools?"* Few answer *"how do I run agents for a team, track what they can and can't do, route actions through human approval, and share a knowledge base across a whole organization?"* That layer is what Team Suzie is.

It is **additive** to your agent runtime, not a replacement for one.

## The five pillars

1. **Multi-tenant by default.** Every piece of state — knowledge, config, skills, approvals — is scoped: `global / org / agent`. An agent queries its own scope plus its org's, transparently.
2. **Skill runtime.** Skills are discoverable, installable, versioned capabilities. Each one ships as a template (instructions + files) that gets injected into an agent's workspace. Composable; no monolithic tool registry.
3. **Human-in-the-loop approvals.** A reusable approval queue primitive with a pluggable dispatcher interface. Agents propose actions; humans approve, reject, or edit; approved actions dispatch via whichever dispatcher is registered for the action type (email, Slack, webhooks, custom — your call). Generic by design: the core package ships with no provider-specific code.
4. **Scoped knowledge bases.** Vector search (Milvus) and graph queries (Neo4j) with the same scope model. One agent, three hierarchical knowledge sources, one query.
5. **Multi-tenant control plane.** Session auth with org/user/agent identity, scoped config inheritance (agent → org → global), and an LLM proxy that attributes every token to the agent that spent it. The substrate that makes the other four pillars coherent across tenants.

## What this repo is not

- **Not an agent runtime.** Bring OpenClaw (proven today) or write an adapter for your own loop. LangGraph and CrewAI are target integrations, not yet validated.
- **Not a foundation model.** The LLM proxy routes to whichever provider you configure.
- **Not a commercial platform.** Billing, paid skills, entitlement enforcement, managed connectors, and hosted orchestration live in the commercial [Team Suzie](https://teamsuzie.com) product, not here.

## Is this useful without the hosted product?

Yes — that's the whole point. Team Suzie OSS is a self-contained, self-hostable stack: auth, multi-tenant knowledge, skill runtime, approval queue, LLM proxy. You can run agents for your own team on your own infrastructure with zero dependency on hosted Team Suzie. The commercial product exists for teams who want managed billing, paid-skill marketplaces, enterprise OAuth, and hosted orchestration on top — it is not a gate in front of the features in this repo.

## Quickstart

What actually works in v0.1:

```bash
git clone https://github.com/firelex/teamsuzie
cd teamsuzie
pnpm install
pnpm -r build         # all packages + apps build clean
pnpm -r test          # 66 tests green
```

To stand up the backend services locally:

```bash
cp .env.example .env
pnpm docker:up        # postgres, redis, milvus, neo4j
pnpm dev:auth         # :3005
pnpm dev:llm-proxy    # :4000
pnpm dev:vector-db    # :3006
pnpm dev:graph-db     # :3007
```

There is no UI to point a browser at yet — the services are REST APIs you build against. A `curl`-driven tour of the pillars lives in [docs/QUICKSTART.md](docs/QUICKSTART.md). A graphical admin and an end-to-end demo agent are the lead items for v0.3.

## Architecture

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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Packages

| Package | Purpose | v0.1 |
|---|---|:---:|
| `@teamsuzie/types` | Shared TypeScript types (scopes, agent context) | ✅ |
| `@teamsuzie/shared-auth` | Multi-tenant auth models (org, user, agent) + 9 tests | ✅ |
| `@teamsuzie/skills` | Headless skill runtime — discovery, template rendering, pluggable target + 11 tests | ✅ |
| `@teamsuzie/approvals` | Approval queue state machine with pluggable store & dispatchers + 18 tests | ✅ |
| `@teamsuzie/db-client` | Typed clients for vector-db and graph-db services | ✅ |
| `@teamsuzie/usage-tracker` | Redis-backed LLM usage event publisher | ✅ |
| `@teamsuzie/config-client` | Scoped config resolver | v0.2 |
| `@teamsuzie/ui` | shadcn/ui component library (lands with admin) | v0.3 |

## Apps

| App | Port | Purpose | v0.1 |
|---|---|---|:---:|
| `auth` | 3005 | Session-based multi-tenant auth | ✅ |
| `llm-proxy` | 4000 | LLM routing with usage tracking + 28 tests | ✅ |
| `vector-db` | 3006 | Scoped Milvus vector search | ✅ |
| `graph-db` | 3007 | Scoped Neo4j graph queries | ✅ |
| `admin` | 3008 | Org / agent / skill management UI | v0.3 |
| `demo` | — | Minimal example agent wired to all of the above | v0.3 |

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
