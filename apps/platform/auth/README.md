# auth

Multi-tenant authentication service. **Port 3005.**

## What it does

- Handles user signup / login (email + password; external identity providers pluggable — see [docs/EXTENSION_MODEL.md](../../docs/EXTENSION_MODEL.md)).
- Issues session cookies with CSRF protection for browser clients.
- Issues optional bearer access tokens for app clients (mobile, Flutter, standalone web clients).
- Validates agent API keys for service-to-service calls.
- Owns the `User`, `Organization`, `OrganizationMember`, `Agent`, `AgentProfile`, and `UserAccessToken` tables.

## Endpoints (summary)

```
POST /login                  (also available as /auth/login)
POST /register               (also available as /auth/register)
POST /logout                 (also available as /auth/logout)
GET  /me                     (also available as /auth/me)
GET  /introspect             (also available as /auth/introspect)
GET  /validate               (alias of introspect)
GET  /tokens                 (list current user's bearer tokens)
POST /tokens                 (issue a new bearer token)
DELETE /tokens/:id           (revoke a bearer token)
```

`POST /login` and `POST /register` support `issue_bearer_token: true` in the JSON body for app/mobile clients. When that flag is present, the auth service bypasses the browser-oriented CSRF check and returns a one-time `access_token` in the response.

## Accounts

Registration is closed unless `AUTH_ALLOW_REGISTRATION=true`: `POST /register` then answers 403. An admin creates
accounts on the machine that runs the service, from this folder:

```
pnpm create-user anna@example.com "Anna Smith"          # add "admin" for an admin
```

The password is asked for and not shown (at least 12 characters).

## Configuration

See `.env.example` at the repo root. Critical variables:

- `POSTGRES_URI` — must be reachable at service start.
- `COOKIE_SECRET` — ≥32 chars; service refuses to start without it in production.

## Client auth modes

- **Browser admin / ops flows** — session cookie + CSRF
- **Mobile / Flutter / standalone web clients** — `Authorization: Bearer <token>`

Use `GET /me` or `GET /introspect` with a bearer token to validate a client session without relying on cookies.

## Status

v0.1 — runnable. Session auth is production-shaped for browser clients, and bearer tokens are available for app-facing clients.
