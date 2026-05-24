# starter-external-agent-counsel

The **SuzieLaw-inspired** starter — a bauhaus / modernist law-office shell. Same backend, same UI primitives as [`starter-external-agent`](../starter-external-agent/README.md); the client visual layer is a faithful port of the [`suzielaw`](../../../../suzielaw/apps/suzielaw/) sibling app's identity (typography, palette, sidebar shell, assistant landing, composer).

## Design

- **Family**: **Archivo** (display + headings), **IBM Plex Sans** (UI body), **IBM Plex Mono** (numerics, IDs, labels).
- **Palette**: warm parchment ground (`oklch(96.5% 0.012 90)`), near-black ink foreground (`oklch(14% 0.005 60)`), **saffron** accent (`oklch(78% 0.155 78)` ≈ `#e8b13a`). Oxblood is reserved for destructive states only.
- **Form**: sharp corners (radii ≈ 0), hairline borders, decorative grid rules. No drop shadows — the parchment ground separates surfaces with crisp ink lines.
- **Shell**: ink-black inverted sidebar with ivory type and a saffron leading bar on the active row. Two-line "SUZIE / LAW" bauhaus wordmark. Nav: Assistant · Matters · Library · Personas · History · Admin · Settings. Footer carries a persona switcher card, status dot, and sign-out affordance.
- **Voice**: direct and operational. "Good evening / How can Counsel help today?" / "Message Counsel" / "Files / Workflow / Send / Stop / New chat". No deferential or ledger-book affectation.

Best fit: legal, compliance, financial advisory, any vertical where the [suzielaw](../../../../suzielaw/) downstream app is the visual reference and you want continuity from a forked starter.

## When to fork this vs the base starter

Fork this when your agent should look and feel like SuzieLaw — bauhaus, restrained, legal-office. If you want something different:

- [`starter-external-agent`](../starter-external-agent/README.md) — the neutral baseline (no opinionated theme)
- [`starter-external-agent-atelier`](../starter-external-agent-atelier/README.md) — editorial paper, Fraunces serif, ink-blue accent
- [`starter-external-agent-console`](../starter-external-agent-console/README.md) — phosphor terminal / all mono (devops, code)
- [`starter-external-agent-glasshouse`](../starter-external-agent-glasshouse/README.md) — refined modernist (ops, finance, healthcare)
- [`starter-external-agent-teamsuzie`](../starter-external-agent-teamsuzie/README.md) — TeamSuzie "Electric Violet" light theme (the SuzieCode look)

## Everything else is the same

Refer to the [base starter README](../starter-external-agent/README.md) for:
- Quick start (`pnpm install && pnpm dev`)
- The three deploy modes (local dev / marketplace agent / marketplace + standalone web)
- Environment variables
- Marketplace lifecycle
- How to extend (custom tools, personas, cookie auth)

Only the client-side visual layer differs:

| File | What changed |
|---|---|
| `client/index.html` | Loads Archivo + IBM Plex Sans + IBM Plex Mono (drops Newsreader) |
| `client/src/index.css` | SuzieLaw bauhaus tokens — parchment + ink + saffron, sharp radii, ink/saffron ramps, `.display-hero`, `.label-caps`, `.label-mono`, `.stagger-in`, `.grid-rules` utilities |
| `client/src/App.tsx` | Ink-black inverted sidebar, two-line `SUZIE / LAW` wordmark, full SuzieLaw nav (Assistant · Matters · Library · Personas · History · Admin · Settings), persona-card footer, saffron status dot |
| `client/src/pages/assistant.tsx` | Direct greeting (`Good evening` via `display-hero`), 2×2 hairline-border prompt cards, `Files` / `Workflow` / `Send` composer, plain Plex Sans body throughout |
| `client/src/pages/{matters,personas,admin}.tsx` | Stub pages that hold the SuzieLaw nav structure — fork to wire your own |

## Stubbed vs implemented

The shell carries SuzieLaw's full structure but the starter only ships the chat surface. Matters / Personas / Admin land as stubs that point at the downstream reference. Fork the starter and:

- Wire **Matters** to your matter store (SuzieLaw uses a SQLite-backed matters table with reviews + matter-scoped chats).
- Wire **Personas** to `@teamsuzie/personas` and `/api/personas`.
- Wire **Admin** to your auth / billing / model surfaces.

The starter is **independent** of `@teamsuzie/pe-ui` and of `suzielaw`'s private domain code — tokens, utilities, and shell are inlined (or imported from `@teamsuzie/ui`) so you can fork without dragging in either workspace.

## Architectural note (open_teamsuzie maintainers)

> **TODO(open_teamsuzie):** the bauhaus utilities (`.display-hero`, `.label-caps`, `.label-mono`, `.rule-hairline`, `.grid-rules`, `.stagger-in`) currently live duplicated in both this starter (`client/src/index.css`) and `suzielaw/apps/suzielaw/client/src/index.css`. Once the pattern stabilises they should move to `@teamsuzie/ui` (a `bauhaus.css` or themed entry) so the starter and the downstream app stay in lock-step from a single import. The `SUZIE / LAW` wordmark, persona-card footer, and inverted-sidebar item class would also benefit from extraction as `@teamsuzie/ui` primitives.

To port a fix from `starter-external-agent` into this variant, copy non-design files (`src/**`, `client/src/pages/{history,library,settings}.tsx`, etc.) verbatim.
