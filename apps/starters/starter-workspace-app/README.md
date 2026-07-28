# starter-workspace-app

A **generic, IA-driven workspace app** — the Stage-0 reference scaffold for the
journey-driven build harness. Stamp it into a target repo, then let the build
agent wire the navigation, object workspaces, and screens from the project's
`docs/ux/layout.json`. **Zero domain vocabulary** — a todo app and a PE platform
stamp the *same* skeleton and diverge only in the agent-added wiring and the real
screen behaviour.

What's **fixed by the template** (don't regenerate): the auth gate (the whole
app sits behind a login page), the app shell, the governance top bar, the global
approval gate, the canonical screen patterns, the typed connector interfaces, the
auth/db/events plumbing, and the `data-testid` contract. What the **agent
generates per build**: the nav/routes/object workspaces (from `layout.json`) and
the real screen behaviour (per journey).

## Stack

- **Server** (`src/`): OAuth/OIDC auth (`OidcClient` + `SessionBundleRepo`,
  always OAuth — no password path), **Postgres** (`pg`) as the authoritative
  **multi-tenant** store (every table carries `tenant_id`; a request-scoped
  tenant context via `AsyncLocalStorage` scopes queries), a tenant-scoped
  `audit_log`, the in-memory `@teamsuzie/events` `EventBus`,
  `@teamsuzie/approvals` queue, `@teamsuzie/email` client, typed connector
  interfaces (no fake data), Express with a session gate + tenant context.
- **Client** (`client/`): Vite + React + `@teamsuzie/ui` + `@teamsuzie/theme` —
  `AppShell` + `Sidebar`, governance `TopBar`, the `ConfirmDialogProvider`
  approval gate, and the canonical pattern library.

## Canonical screen patterns (`client/src/patterns`)

Every screen renders one of these archetypes, mapped from a `layout.json`
pattern's `kind`. Author a new pattern only when none fits.

| Pattern | Archetype | Composes |
|---|---|---|
| `CollectionWorkspace` | list / queue / index / feed | `DataTable` + filter + bulk + primary action |
| `RecordWorkspace` | object detail | `RecordDetailLayout` + sidebar + tabbed body |
| `GuidedWorkflowRun` | multi-step guided run | stepper + terminal action **via the approval gate** |
| `DeliverableReview` | review & approve a deliverable | preview + approve **via the approval gate** |
| `ConfigEditor` | settings / governance editor | editor + edit→confirm→activate **via the approval gate** |

## The auth gate

`AuthGate` (`client/src/components/AuthGate.tsx`) wraps the whole app in
`src/main.tsx`. On load it probes the session once (`GET /api/auth/me`); an
anonymous user sees the **login page and nothing else**, and the shell, nav, and
every data widget render only after sign-in. This is the boundary — the whole
site sits behind login. Because unauthenticated users can't reach protected
screens, those screens must **not** fall back to inline "Authentication required"
boxes as their primary unauthenticated UX; that state is unreachable in normal
use. The static client is served to anonymous users (only `/api` is gated), so
the login page can always load. `useAuth()` exposes the signed-in user to the
authed subtree. **Fixed by the template — don't remove or bypass it.**

## The approval gate

`ConfirmDialogProvider` wraps the app (`src/main.tsx`); every side-effecting
pattern confirms through `useConfirm()` before acting. This is how "every
side-effect routes through an explicit approval" holds across the whole app.

## The testid contract (`client/src/lib/testids.ts`)

Stable `data-testid`s are baked into the shell, top bar, approval flow, and every
pattern root, so journey-driven acceptance tests have deterministic targets
regardless of an app's domain content. **Don't rename them** — reuse them by
rendering the canonical patterns.

## The shell is fixed — `WorkspaceShell`

`client/src/components/AppShell.tsx` renders the canonical `@teamsuzie/ui`
`WorkspaceShell`, which produces chrome **identical to the Suzie IT Department
parent app** (gradient sidebar, teamsuzie.com wordmark, grouped nav with section
labels + dividers, user footer, and the top-bar frame). Every app runs the same
kit component, so they can't drift apart. **The agent does not edit the shell
markup** — it feeds it data. Restyling the sidebar/top-bar per app is a bug.

## What the build agent wires from `layout.json`

1. `NAV_GROUPS` in `client/src/lib/nav.ts` — one group per nav section, one item
   per nav entry (id/path/label/icon). `WorkspaceShell` renders these into the
   canonical sidebar. This is the ONLY shell wiring the agent does.
2. A `<Route>` per nav item / object workspace in `client/src/App.tsx`, each
   rendering a canonical pattern.
3. A `RecordWorkspace` per object (tabs from `layout.json`).
4. App controls in `client/src/components/TopBar.tsx` (dropped into the fixed
   top-bar frame) — credits/approvals/audit and any app-specific governance.
5. App-specific connectors registered on the server's `ConnectorRegistry`, and
   domain routers mounted on `context` in `src/index.ts`.

## Run

```bash
pnpm install                 # from the open_teamsuzie monorepo root
pnpm --filter @teamsuzie/starter-workspace-app dev   # server + client
```

Server: `http://localhost:5211` · client (Vite): `http://localhost:5273` (proxies
`/api` to the server).

Env: `DATABASE_URL` (Postgres — required; a reachable Postgres is needed),
`DEFAULT_TENANT_ID`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_REDIRECT_URI`, `OIDC_RESOURCE`, `WEB_ORIGIN`, `SESSION_SECRET`, `PORT`.
Auth needs a reachable OIDC provider. The schema (tenants, user_sessions,
audit_log) is created on boot; domain tables the agent adds must carry
`tenant_id` and be queried through `currentTenantId()`.

## Stamping (used by the harness)

The Stage-0 step copies this directory into the target repo (degit-style,
without the monorepo `.git`). The stamped app keeps `@teamsuzie/*` as live deps
so it tracks kit changes. This template is itself a real app in the monorepo, so
it's typechecked/built in CI and stays current.
