# starter-department-agent

A neutral starter for building a **Team Suzie "department agent"** app —
an operational, agent-assisted vertical (executive assistant, customer
support, ops, research, …) that shares the same visual identity, page
shell, and component vocabulary as `suzie-it-department` without having
to fork it.

## What's in the box

- **Vite + React 19 + Tailwind 4** scaffolding, ready to run.
- **`@teamsuzie/theme`** — the canonical electric-violet design tokens,
  brand utility classes (`bg-header-gradient`, `bg-fancy-gradient`,
  `font-mono-data`, …), and reveal animations.
- **`@teamsuzie/ui`** — every shared component the IT department uses:
  `AppShell`, `Sidebar`, `PageShell`, `PageBody`, `ActivityPill`,
  `GeneratingPanel`, `CollapsibleSidePanel`, `MarkdownView`,
  `MermaidBlock`, `ChatThread`, plus the full shadcn/Radix primitive set.
- **Neutral routes**: `/`, `/chat`, `/activity`, `/work-queue`,
  `/artifacts`, `/approvals`, `/settings` — each page is a small,
  realistic placeholder using the shared shell.

## What is *not* here yet

This starter is the **design + shell** baseline. It does not include:

- A server. Add Express / your framework alongside and proxy `/api` in
  `vite.config.ts` — see `starter-external-agent-teamsuzie` for a
  working server + client pair.
- Auth. Wire `@teamsuzie/shared-auth` or your own OIDC client.
- Durable chat / events / approvals storage. Use `@teamsuzie/chats`,
  `@teamsuzie/events`, `@teamsuzie/approvals` once your server is in.
- `@teamsuzie/platform-bridge` / `@teamsuzie/agent-runtime` wiring.
  These belong on the server; mount them in your backend and expose the
  SSE endpoints your client subscribes to.

## Running it

```sh
cd apps/starters/starter-department-agent
pnpm install   # from the open_teamsuzie root: `pnpm install`
pnpm dev       # http://localhost:5173
```

## Creating a new department from this starter

1. Copy `apps/starters/starter-department-agent` to
   `apps/<your-vertical>/` (or to its own repo if you want isolation
   like `suzie-it-department`).
2. Rename `name` in `package.json`.
3. Rebrand `src/components/AppShell.tsx`:
   - Change the wordmark text ("Department" → your vertical name).
   - Adjust the gradient and icon if your vertical wants its own accent.
4. Replace the placeholder data in each page with feeds from your
   platform-bridge / store layer.
5. Add or remove sidebar nav entries to match the vertical (e.g. an
   executive assistant adds `Calendar` + `Inbox` and drops
   `Work queue`).
6. Wire a server and proxy `/api`.

Everything you don't change stays **identical** to other Team Suzie
departments — and gets every future upgrade to `@teamsuzie/ui` /
`@teamsuzie/theme` for free.

## What to keep vs. replace

| Keep | Replace |
|---|---|
| Tailwind 4 + `@teamsuzie/theme` import order in `index.css` | Page contents |
| `PageShell` editorial hero band shape (kicker + title + tagline) | Specific kicker/title copy per page |
| `AppShell` + `Sidebar` composition | Brand mark and nav entries |
| Neutral vocabulary (`subject`, `run`, `artifact`, `approval`) | Vertical-specific labels under those nouns |
| `ActivityPill` variants (`work-run-active`, `awaiting-user`, etc.) | The events you push into them |

## Vocabulary

The brief is explicit: keep new departments using the neutral nouns so
the family reads as one product.

- **subject** — the thing the agent is working on (a ticket, a matter,
  a customer, an inbox item — whichever maps to your vertical).
- **workspace** — the container that holds subjects (a project, a
  matter folder, a customer record, …).
- **item** — a row in the work queue.
- **run** — a single agent execution attached to an item.
- **artifact** — generated output (doc, report, draft email, …).
- **activity** — telemetry about who/what is working.
- **approval** — a paused run waiting for a human green-light.

Do not use "project", "ticket", or "PR" as the universal noun in the
shared shell — those belong to specific verticals.
