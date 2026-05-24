# starter-external-agent-glasshouse

A **refined modernist** themed variant of [`starter-external-agent`](../starter-external-agent/README.md). Same backend, same UI primitives — distinct visual identity, ready to fork.

## Design

- **Family**: Geist sans for body, Instrument Serif italic for a single editorial display moment, JetBrains Mono for code/tool args.
- **Palette**: cool desaturated paper-white background, deep ink foreground, single deep-teal accent, with a soft teal glow in the bottom-right corner.
- **Voice**: "in attendance", "begin again", "write to…". The agent is a discreet professional collaborator.
- **Distinctive details**: geometric wordmark with inset highlight and rotated inner-square, italic-serif accent on the greeting headline ("how can {name} help?"), generous prompt cards with hairline border that warms to teal on hover, composer with a 3px teal halo on focus.

Best fit: ops, finance, healthcare, analytics — verticals that want premium polish without playfulness.

## When to fork this vs the base starter

Fork this when your agent's audience expects **enterprise polish**. The modest gradient backgrounds, soft shadows, italic-serif counterpoint, and teal halo on focus signal that a careful designer was here, without ever leaving the visual register of a serious tool.

If the agent's output is mostly long-form prose, fork [`starter-external-agent-atelier`](../starter-external-agent-atelier/README.md). If it's developer-shaped, fork [`starter-external-agent-console`](../starter-external-agent-console/README.md). For PE-suite visual continuity, fork [`starter-external-agent-counsel`](../starter-external-agent-counsel/README.md). For TeamSuzie brand continuity (Electric Violet), fork [`starter-external-agent-teamsuzie`](../starter-external-agent-teamsuzie/README.md).

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
| `client/index.html` | Loads Geist + Instrument Serif + JetBrains Mono from Google Fonts |
| `client/src/index.css` | Theme tokens, soft radial-gradient background, `glasshouse-*` utility classes |
| `client/src/App.tsx` | `Wordmark` — geometric mark + two-line label |
| `client/src/pages/assistant.tsx` | Header, greeting (with serif italic accent), cards, composer |

To port a fix from `starter-external-agent` into this variant, copy non-design files (`src/**`, `client/src/pages/{history,library,settings}.tsx`, etc.) verbatim.
