# @teamsuzie/shared-auth

Multi-tenant auth models, session service, and middleware for Team Suzie.

## What's here

- **Models:** `User`, `Organization`, `OrganizationMember`, `Agent`, `AgentProfile`, `AgentWorkspaceFile`, `ApiKey` (Sequelize).
- **Services:** `SequelizeService` (db connection), `SessionService` (cookie-based sessions), `ApiKeyService` (agent bearer auth).
- **Middleware:** session auth, CSRF, API key auth, role guards.
- **Factory:** `createAuthRouter()` — mount-point for the auth routes used by `apps/auth`.

## What's explicitly *not* here

- **No billing models.** `OrgBilling`, `BillingTransaction`, Stripe references — those live in the commercial product, not the OSS layer. If you need billing, build your own adapter in a separate package; don't add it here.
- **No entitlement logic.** The skill runtime treats all installable skills as available. Commercial paid-skill enforcement lives elsewhere.

## Extension

- New identity providers (SSO, SAML, OIDC): add a route in `apps/auth` that lands on `SessionService.issue()` once external auth succeeds. The rest of the stack doesn't care how identity was proven.
- New model fields: add a Sequelize migration; don't hand-edit schema.

## Status

v0.1 — being extracted. The private upstream includes billing-related exports that will be removed before landing here.
