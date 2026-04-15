# Roadmap

Team Suzie OSS is an extraction from a working private codebase. The roadmap reflects what's already built upstream and what needs refactoring before it can land here.

## v0.1 — Runnable foundations *(current)*

Goal: the pillars ship as runnable, tested TypeScript packages. Ten workspace projects build clean; 66 unit tests pass. The admin UI, demo agent, and first-party application integrations land in later phases — this release is for engineers wiring their own applications on top.

- [x] Repository structure and positioning docs
- [x] MIT license, contributing guide, security policy
- [x] Docker Compose for local infrastructure (Postgres, Redis, Milvus, Neo4j)
- [x] `packages/types` — shared scope and agent context types
- [x] `packages/shared-auth` — org/user/agent models (billing stripped)
- [x] `apps/platform/auth` — session-based auth service
- [x] `apps/platform/llm-proxy` — provider-agnostic LLM router with usage tracking

## v0.2 — Runnable end-to-end

Goal: `pnpm install && pnpm docker:up && pnpm dev` produces a working multi-tenant stack a developer can build on.

- [x] `apps/platform/vector-db` — Milvus REST wrapper with scope support
- [x] `apps/platform/graph-db` — Neo4j REST wrapper with scope support
- [x] `packages/db-client` — typed clients for both DB services
- [x] `packages/usage-tracker` — Redis-backed usage event publisher
- [ ] `packages/config-client` — scoped config resolver
- [ ] `apps/platform/admin` — slim admin UI (org / agent / config / skill management)
- [ ] `apps/starters/demo` — minimal example agent wired through the full stack
- [ ] CI green on fresh clone (builds + unit tests green today; integration coverage pending)

## v0.3 — Skill runtime — first-party skills + admin integration

The headless skill runtime (`packages/skills`) landed in v0.1. v0.3 is about shipping
real first-party skills that do useful things, which depends on the admin app and
LLM proxy being runnable end-to-end.

- [ ] First-party skills: inter-agent messaging, token usage, file access (generic), `hello-world` (already shipped)
- [ ] DB-backed `SkillTarget` implementation in the admin app (upserts into `AgentWorkspaceFile`)
- [ ] Skill authoring guide expanded in `docs/EXTENSION_MODEL.md`
- [ ] Skill UI in the admin app (browse catalog, install / uninstall per agent)

## v0.4 — Approval queue — durable storage + reference dispatchers

The generic state machine and in-memory store shipped in v0.1. v0.4 is about
making the queue production-viable by adding a durable store and at least one
first-party dispatcher.

- [ ] Postgres / Sequelize `ApprovalStore` implementation (likely co-located with admin)
- [ ] Email dispatcher reference implementation (provider-agnostic; SendGrid / Resend / SMTP)
- [ ] Admin UI: list, review, edit, dispatch approval items
- [ ] Worker pattern docs (BullMQ or equivalent) for async dispatch

## v0.5 — Generalization and polish

- [ ] Generalize approval queue away from email-specific field names
- [ ] Pluggable LLM provider adapters (third-party providers via plugins)
- [ ] Pluggable vector/graph backends (beyond Milvus/Neo4j)
- [ ] First external adapter contributions merged

## Explicitly not planned for OSS

These features exist upstream in the commercial [Team Suzie](https://teamsuzie.com) product and will stay there:

- Stripe billing, credits, subscriptions, BYOK management
- Paid-skill entitlements and enforcement
- Managed OAuth for Gmail / Outlook / Jira / etc. (OSS ships the interfaces; bring your own OAuth app)
- Kubernetes deployment manifests and hosted orchestration
- Customer-specific templates and integrations (Scissero, WSD, etc.)
- Premium document drafting (DOCX generation with styled templates)
- Voice agent (may be open-sourced separately later)

If you want those, use the hosted service. If you want to build your own variant, the seams are documented in [ARCHITECTURE.md](ARCHITECTURE.md).
