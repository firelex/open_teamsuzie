# @teamsuzie/shared-auth

Multi-tenant auth models, session service, and middleware for Team Suzie.

## What's here

- **Models:** `User`, `Organization`, `OrganizationMember`, `Agent`, `AgentProfile`, `AgentWorkspaceFile`, `ApiKey` (Sequelize).
- **Services:** `SequelizeService` (db connection), `SessionService` (cookie-based sessions), `ApiKeyService` (agent bearer auth).
- **Middleware:** session auth, CSRF, API key auth, role guards.
- **Factory:** `createAuthRouter()` — mount-point for the auth routes used by `apps/platform/auth`.
  `POST /register` follows `SharedAuthConfig.registration` (`parseRegistrationPolicy(process.env)` reads
  `AUTH_REGISTRATION` / `AUTH_REGISTRATION_DOMAINS`); unset means closed. `GET /users` needs an admin and
  `GET /users/by-email/:email` an admin or the caller's own address.

## User administration

For a single-firm app that manages its own people (invite, change role, deactivate, reset password, remove),
rather than self-service registration:

- `createUserAdminRouter(opts: UserAdminOptions)` — admin-only routes: list/patch/delete a user, issue a password
  reset, list/create/revoke invites. Mount it behind the app's own `requireAuth`.
- `createUserAdminPublicRouter(opts: UserAdminOptions)` — the public routes a person without an account (or
  password) uses from a link an admin gave them: look up an invite, accept an invite, use a password-reset token.
- `UserAdminOptions` ties both routers to the host app: a `UserAdminStore` (the Sequelize-backed
  `SequelizeUserAdminStore` by default), a `SessionTracker`, an `onChange` callback run after each successful
  change (for audit logging — a throw fails the request), and `beforeDelete` (may refuse a removal, e.g. to force
  transferring ownership of a person's work first).
- `ensureUserAdminSchema(sequelize)` — run once after `sync()`. Adds the columns later releases introduced
  (`users.is_active`, `users.last_sign_in_at`, `org_invite.email`) only where a table is missing them (and only for
  models the app registered), so it is safe to run on every boot. It refuses to start when two accounts' emails are
  equal once capital letters are ignored, naming both.
- Emails are compared ignoring capital letters everywhere (`emailMatches(email)` builds that `where` clause). New
  accounts are stored lower-cased; older rows keep their capitals and are never rewritten, because apps key their
  own data by the stored string.
- `SessionTracker(redis, keyPrefix, ttlSeconds)` — pass `sessionTrackerTtlSeconds(config)` (the cookie `maxAge`,
  or 30 days when unset) so each user's set of sessions expires. Every sign-in that records its session (login,
  register, invite accept) also sets `session.trackedForSignOut = true`; an app that reads the identity from the
  session should treat a session without it as signed out, since nothing could end it.
- `workThenSignOut(work, signOut)` — runs `work`, then always `signOut`, keeping both errors if both fail. The
  routers use it; apps can use it for their own deletion flows.
- `ensureFirmOrganization(name)` — run at boot (after `ensureUserAdminSchema`). Creates the one organisation a
  single-firm installation keeps its people in, or renames it if the configured name changed. `setFirmMembership`
  and `firmOrganization` work against that same organisation.
- Rules enforced inside the routers, not left to the host app: invites are one-time, bound to one email, and
  expire 7 days after creation; password-reset links are one-time and expire 24 hours after creation; both are
  stored only as a SHA-256 hash (`hashToken`), never the raw token. A password set through an invite or a reset
  link must be at least 12 characters. Any change that would leave the firm with zero active admins is refused
  with HTTP 409 and `error: 'last_admin'`, decided inside a database transaction that locks the active-admin rows
  so two concurrent changes can't both pass. After a role change, deactivation, reset, or removal, the target's
  sessions are ended and their bearer tokens revoked before the response is sent; if that clean-up and the
  sign-out both fail, the thrown error names both failures.

## What's explicitly *not* here

- **No billing models.** `OrgBilling`, `BillingTransaction`, Stripe references — those live in the commercial product, not the OSS layer. If you need billing, build your own adapter in a separate package; don't add it here.
- **No entitlement logic.** The skill runtime treats all installable skills as available. Commercial paid-skill enforcement lives elsewhere.

## Extension

- New identity providers (SSO, SAML, OIDC): add a route in `apps/platform/auth` that lands on `SessionService.issue()` once external auth succeeds. The rest of the stack doesn't care how identity was proven.
- New model fields: add a Sequelize migration; don't hand-edit schema.

## Status

v0.1 — being extracted. The private upstream includes billing-related exports that will be removed before landing here.
