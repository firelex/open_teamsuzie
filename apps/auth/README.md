# auth

Multi-tenant authentication service. **Port 3005.**

## What it does

- Handles user signup / login (email + password; external identity providers pluggable — see [docs/EXTENSION_MODEL.md](../../docs/EXTENSION_MODEL.md)).
- Issues session cookies with CSRF protection.
- Validates agent API keys for service-to-service calls.
- Owns the `User`, `Organization`, `OrganizationMember`, `Agent`, `AgentProfile` tables.

## Endpoints (summary)

```
POST /auth/signup
POST /auth/login
POST /auth/logout
GET  /auth/me
POST /auth/agents/:id/api-keys       (org admin)
GET  /auth/validate                  (internal: called by other services)
```

## Configuration

See `.env.example` at the repo root. Critical variables:

- `POSTGRES_URI` — must be reachable at service start.
- `COOKIE_SECRET` — ≥32 chars; service refuses to start without it in production.

## Status

v0.1 — being extracted.
