# auth

Multi-tenant authentication service. **Port 3005.**

## What it does

- Handles user login, and signup when registration is opened, (email + password; external identity providers pluggable — see [docs/EXTENSION_MODEL.md](../../docs/EXTENSION_MODEL.md)).
- Issues session cookies with CSRF protection for browser clients.
- Issues optional bearer access tokens for app clients (mobile, Flutter, standalone web clients).
- Validates agent API keys for service-to-service calls.
- Owns the `User`, `Organization`, `OrganizationMember`, `OrgDomain`, `Agent`, `AgentProfile`, and `UserAccessToken` tables.

## Endpoints (summary)

The JSON routes are mounted at both `/api/auth/*` and `/auth/*`.

| Route | Who may call it |
| --- | --- |
| `POST /login` | anyone (rate limited) |
| `POST /register` | anyone, if registration allows the email (see below; rate limited) |
| `POST /logout` | anyone (ends the caller's own session / token) |
| `GET /me`, `GET /introspect`, `GET /validate` | a signed-in caller; returns their own record |
| `GET /tokens`, `POST /tokens`, `DELETE /tokens/:id` | a signed-in caller; their own bearer tokens only |
| `GET /users` | an admin (401 if not signed in, 403 if not an admin) |
| `GET /users/by-email/:email` | an admin, or the caller looking up their own address (401 / 403 otherwise) |
| `GET /config` | anyone: the CSRF cookie name and the registration mode |
| `GET /api/health` | anyone |
| `/oauth/interaction/:uid` | the OIDC sign-in page (rate limited) |

"Signed in" means a session cookie or `Authorization: Bearer <token>`. An admin is a user whose stored `role` is
`admin`.

`POST /login` and `POST /register` support `issue_bearer_token: true` in the JSON body for app/mobile clients. When that flag is present, the auth service bypasses the browser-oriented CSRF check and returns a one-time `access_token` in the response.

## Accounts and registration

`AUTH_REGISTRATION` decides who may create an account with `POST /register`:

- `closed` (the default, also when unset): nobody; `POST /register` answers 403. An admin creates accounts.
- `open`: anyone.
- `domains`: only emails at one of `AUTH_REGISTRATION_DOMAINS` (comma-separated, e.g. `example.com,example.org`;
  exact match, so subdomains are not included). The service refuses to start if the list is empty.

Any other value stops the service at start-up, so a typo cannot open registration. `GET /config` reports the mode,
and the sign-in page tells people without an account to ask an administrator when registration is closed.

There is no email verification: with `domains`, anyone who types an address at a listed domain can register it,
whether or not they can read that mailbox. Use `domains` only where that is acceptable, or keep registration closed.

To create an account (for example the first admin) on the machine that runs the service, after `pnpm build`:

```
echo -n "$PASSWORD" | node scripts/create-user.mjs anna@example.com "Anna Smith"          # add "admin" for an admin
```

The password is read from standard input (at least 12 characters), so it stays out of the shell history.

## Rate limits

Sign-in attempts (the OIDC sign-in page and `POST /login`) and registration attempts are each limited per client
address and per email, in memory:

- `AUTH_RATE_LIMIT_MAX_PER_IP` (default `10`) and `AUTH_RATE_LIMIT_MAX_PER_ACCOUNT` (default `10`) attempts per
  `AUTH_RATE_LIMIT_WINDOW_MS` (default `60000`, one minute).
- Over the limit the JSON routes answer 429 and the sign-in page shows an error, both with `Retry-After`.
- A successful sign-in is not counted; every registration attempt is.
- The counts are per process: several instances each keep their own, and a restart clears them.

Behind a reverse proxy, set `AUTH_TRUST_PROXY` (Express's `trust proxy`: a hop count such as `1`, `true`, or proxy
addresses) so the limit sees each client's address. Without it every client has the proxy's address and they all
share one limit; the service warns about this at start-up in production.

## Configuration

See `.env.example` at the repo root. Critical variables:

- `POSTGRES_URI` — must be reachable at service start.
- `COOKIE_SECRET` — ≥32 chars; service refuses to start without it in production.
- `OIDC_COOKIE_SECRET` — signs the OIDC provider's cookies; required in production.
- `AUTH_REGISTRATION`, `AUTH_REGISTRATION_DOMAINS` — who may sign up (default: nobody). See above.
- `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX_PER_IP`, `AUTH_RATE_LIMIT_MAX_PER_ACCOUNT`, `AUTH_TRUST_PROXY` —
  see Rate limits.

## Tests

```
pnpm test        # vitest
pnpm typecheck   # includes the tests
```

## Client auth modes

- **Browser admin / ops flows** — session cookie + CSRF
- **Mobile / Flutter / standalone web clients** — `Authorization: Bearer <token>`

Use `GET /me` or `GET /introspect` with a bearer token to validate a client session without relying on cookies.

## Status

v0.1 — runnable. Session auth is production-shaped for browser clients, and bearer tokens are available for app-facing clients.
