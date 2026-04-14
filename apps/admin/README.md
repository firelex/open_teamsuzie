# admin

Slim admin UI + API for managing orgs, agents, config, skills, and approvals. **Port 3008.**

## What it does

- Org management: create orgs, invite members, manage membership.
- Agent management: create agents from profiles, issue / revoke API keys.
- Config: global / org / agent-scoped config editor.
- Skills: browse catalog, install / uninstall skills on agents.
- Approvals: review pending agent-proposed actions.

## What's explicitly *not* here

Compared to the private upstream, the OSS admin app **does not** include:

- Billing dashboards, credits, invoices, Stripe integration.
- Paid-skill entitlement enforcement.
- Managed-connector OAuth flows (Gmail / Outlook / Jira with hosted credentials).
- Kubernetes deployment controls.

Those are commercial features. The OSS admin stops at "configure and observe" — anything past that (paywalling, enterprise OAuth, hosted orchestration) lives in the commercial product.

## Stack

Express + React (via Vite) + shadcn/ui (from `@teamsuzie/ui`). The API routes are in `src/controllers/` and `src/routes/`; the client is in `src/client/`.

## Status

v0.1 — being extracted. Billing-related code will be stripped before landing.
