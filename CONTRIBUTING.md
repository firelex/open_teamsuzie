# Contributing to Team Suzie

Thanks for your interest. Team Suzie is in early OSS days (v0.1), so the contribution surface is deliberately small while the architecture settles.

## What we're looking for

**Welcome:**
- Bug reports with reproductions.
- Documentation improvements.
- Adapters for additional LLM providers in `apps/llm-proxy`.
- Adapters for additional vector / graph backends in `apps/vector-db` and `apps/graph-db`.
- New skill templates in `packages/skills`.
- Approval-queue consumers beyond email.

**Hold off on** large refactors, new top-level packages, or changes to core abstractions (scopes, skill runtime contract, approval state machine) until the v0.2 architecture doc lands — those are actively in flux.

## Local development

See [docs/QUICKSTART.md](docs/QUICKSTART.md).

## Pull requests

- One logical change per PR.
- Include tests where the behavior is testable without the full stack (unit tests beat integration tests for PRs).
- Update the relevant package's README if you change its public surface.
- No new dependencies on private or non-public registries.

## Code style

- TypeScript strict mode.
- Prefer editing existing files over creating new ones.
- Match existing patterns in the file you're editing.

## Commercial vs OSS boundary

This repo is the **business operating layer** (skills, approvals, multi-tenant substrate). Features that belong to the commercial [Team Suzie](https://teamsuzie.com) product — billing, paid-skill entitlements, managed OAuth for enterprise connectors, hosted orchestration — are **out of scope** here and will be declined.

If you're unsure whether something fits, open an issue before writing code.

## Security

Please do not file security issues as public GitHub issues. See [SECURITY.md](SECURITY.md).
