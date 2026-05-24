# starter-external-agent-suziecode

A starter variant that lifts the **SuzieCode app** visual identity ([`apps/suziecode/client/`](https://github.com/scissero/suziecode)). Same backend, same UI primitives as [`starter-external-agent`](../starter-external-agent/README.md) — distinct visual identity, ready to fork.

## Design

- **Family**: Inter (body, semibold for emphasis) + JetBrains Mono (eyebrows, pills, buttons). Same combo SuzieCode uses.
- **Palette**: graphite background (`oklch(14% 0.01 270)`), bright indigo violet primary (`oklch(68% 0.19 275)`), soft violet glow in the bottom-right + cool blue gradient in the top-left.
- **Voice**: "session · YYYY-MM-DD", "online", "new session", "ask…", "send ↵". An engineering-tool register — like the SuzieCode UI itself.
- **Distinctive details**: code-brace `{}` wordmark in a violet outlined pill, dotted-violet glossary-term highlight on the agent name, monospaced uppercase eyebrows and pill badges, side-rule (`border-l-2`) treatment on assistant messages, violet ring on composer focus.

Best fit: developer tooling, planning/spec agents, engineering ops — anything whose audience is already at home in the SuzieCode app.

## When to fork this vs the base starter

Fork this when your agent is a **technical companion** sitting in the same workflow as SuzieCode itself, and you want immediate visual continuity. The eyebrows, pills, side rules and dotted-underline language do most of the work — a user who knows SuzieCode will recognize the family at a glance.

For other directions, see the sibling starters:
- [`starter-external-agent-atelier`](../starter-external-agent-atelier/README.md) — editorial paper / Fraunces (research, diligence, legal)
- [`starter-external-agent-console`](../starter-external-agent-console/README.md) — phosphor terminal / all mono (devops, code)
- [`starter-external-agent-glasshouse`](../starter-external-agent-glasshouse/README.md) — refined modernist (ops, finance, healthcare)
- [`starter-external-agent-counsel`](../starter-external-agent-counsel/README.md) — PE editorial (Newsreader + oxblood) for agents shipping alongside the PE suite
- [`starter-external-agent-teamsuzie`](../starter-external-agent-teamsuzie/README.md) — TeamSuzie "Electric Violet" light theme (the **new** SuzieCode look; this `-suziecode` variant kept around as the **previous** dark look)

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
| `client/src/index.css` | Theme tokens + `suzie-*` utility classes lifted from `apps/suziecode/client/src/index.css` |
| `client/src/App.tsx` | `Wordmark` — `{}` brace mark + two-line label |
| `client/src/pages/assistant.tsx` | Header, greeting, bubbles (user card + assistant side-rule), composer |

To port a fix from `starter-external-agent` into this variant, copy non-design files (`src/**`, `client/src/pages/{history,library,settings}.tsx`, etc.) verbatim.
