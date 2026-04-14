# Security policy

## Supported versions

Team Suzie is pre-1.0. Security fixes are applied to the latest `main`. There are no back-ported patches at this stage.

## Reporting a vulnerability

Please **do not** file security vulnerabilities as public GitHub issues.

Email: `security@teamsuzie.com` (or the contact listed on the repo maintainer's profile if that address is unavailable).

Include:
- A description of the vulnerability and its impact.
- Steps to reproduce.
- The affected version or commit SHA.
- Any suggested mitigation.

You can expect an initial response within 72 hours. We will coordinate a disclosure timeline with you before publishing any fix.

## Scope

In scope:
- Auth bypass, privilege escalation, tenant data leakage across scopes.
- Injection vulnerabilities (SQL, Cypher, command, prompt injection in skill templates).
- Secrets accidentally committed to the repo.
- Supply-chain risks in declared dependencies.

Out of scope:
- Vulnerabilities in downstream agent runtimes (OpenClaw, LangGraph, etc.) — report those upstream.
- Denial of service from unthrottled self-hosted deployments (configure your own rate limits).
- Issues that require physical access to the host.

## Hardening defaults

When deploying Team Suzie, at minimum:
- Set `COOKIE_SECRET` and `CONFIG_ENCRYPTION_KEY` to strong random values.
- Do not run with the default Postgres / Neo4j passwords from `.env.example`.
- Put the admin app behind authentication; it exposes privileged config operations.
- Keep the LLM proxy internal — do not expose it to the public internet without an auth layer.
