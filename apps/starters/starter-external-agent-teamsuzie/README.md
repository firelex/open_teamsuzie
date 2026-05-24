# starter-external-agent-teamsuzie

A starter variant that lifts the **TeamSuzie** "Electric Violet" identity originally from `suzie_monorepo/apps/admin` (and now used by the [SuzieCode app](../../../../suziecode/) itself). Same backend, same UI primitives as [`starter-external-agent`](../starter-external-agent/README.md) — distinct visual identity, ready to fork.

## Design

- **Family**: Inter (body + headings) with cv02/cv03/cv04/cv11 alternate glyphs (single-storey `a`, straight `l`, etc.), JetBrains Mono for code/tokens.
- **Palette**: cool near-white background (`oklch(98% 0.002 286)`), deep ink foreground, **electric-violet** primary (`oklch(48% 0.27 290)` ≈ `#7547FE`) + the signature 78° gradient `#7438FE → #D267FF` reserved for hero accents.
- **Voice**: "Welcome", "Good evening, how can {name} help?", "New thread", "online". Energetic, modern, product-feel.
- **Distinctive details**: gradient violet square wordmark with soft violet drop-shadow; "TEAMSUZIE" eyebrow under the title; gradient text moment in the greeting (`how can {name} help?`); hero atmosphere — soft violet + magenta + faint teal radial halos behind hero copy; user bubbles use the same 78° gradient with a violet glow; assistant messages are introduced by a soft violet `bg-ev-50` brand chip; "Send" button is a gradient pill; composer focus ring is 4px `rgba(117,71,254,0.12)`; staggered `ts-reveal` fades on first paint.

Best fit: TeamSuzie surface agents, SuzieCode-adjacent tooling, marketing-quality product chrome. Anywhere the user has just come from the TeamSuzie landing or admin and shouldn't feel they've left it.

## When to fork this vs the base starter

Fork this when your agent ships under the **TeamSuzie brand** or sits next to surfaces that use the Electric Violet identity. The gradient bubbles + atmosphere + Inter cv-alternates do the brand-recognition work for you — the user feels they're still inside the same product family.

For other directions:
- [`starter-external-agent-atelier`](../starter-external-agent-atelier/README.md) — editorial paper / Fraunces (research, diligence, legal)
- [`starter-external-agent-console`](../starter-external-agent-console/README.md) — phosphor terminal / all mono (devops, code)
- [`starter-external-agent-glasshouse`](../starter-external-agent-glasshouse/README.md) — refined modernist (ops, finance, healthcare)
- [`starter-external-agent-counsel`](../starter-external-agent-counsel/README.md) — PE editorial (Newsreader + oxblood) for agents shipping alongside the PE suite
- [`starter-external-agent-suziecode`](../starter-external-agent-suziecode/README.md) — dark graphite + violet (the previous SuzieCode look, before TeamSuzie)

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
| `client/index.html` | Loads Inter + JetBrains Mono from Google Fonts |
| `client/src/index.css` | Theme tokens (Electric Violet palette, EV 50-950 scale) + `ts-*` utility classes lifted from `apps/suziecode/.../client/src/index.css` |
| `client/src/App.tsx` | `Wordmark` — gradient violet square + TEAMSUZIE eyebrow |
| `client/src/pages/assistant.tsx` | Header (with gradient dot), greeting (atmosphere + text-fancy moment + staggered reveal), bubbles (gradient user + brand-chip assistant), cards, composer with gradient Send |

To port a fix from `starter-external-agent` into this variant, copy non-design files (`src/**`, `client/src/pages/{history,library,settings}.tsx`, etc.) verbatim.
