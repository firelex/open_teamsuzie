# starter-external-agent-atelier

An **editorial-paper** themed variant of [`starter-external-agent`](../starter-external-agent/README.md). Same backend, same UI primitives — distinct visual identity, ready to fork.

## Design

- **Family**: Fraunces (single-family with optical-size + italic axes), JetBrains Mono for tool args.
- **Palette**: warm cream paper background, deep ink-blue foreground, single ink-blue accent.
- **Voice**: "in session with", "enclose", "a note to", "send →". The agent is a correspondent, not a chatbot.
- **Distinctive details**: rotated ink-stamp wordmark, Roman-numeral prompt cards, hairline rule with inked dot, drop-cap on assistant prose, corner ticks on bubbles and composer card.

Best fit: research, diligence, legal, advisory — verticals where the user expects to read carefully.

## When to fork this vs the base starter

Fork this when your agent's interaction is **prose-heavy** and the user spends most of their time reading the assistant's output. The drop-cap, generous line-height (1.65), and serif body make long-form responses feel like a publication — not a chat log.

If your agent is mostly tool-use, status, or short turns, fork [`starter-external-agent-console`](../starter-external-agent-console/README.md). For premium B2B, fork [`starter-external-agent-glasshouse`](../starter-external-agent-glasshouse/README.md). For PE-suite visual continuity (oxblood + Newsreader), fork [`starter-external-agent-counsel`](../starter-external-agent-counsel/README.md). For TeamSuzie brand continuity (Electric Violet), fork [`starter-external-agent-teamsuzie`](../starter-external-agent-teamsuzie/README.md).

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
| `client/index.html` | Loads Fraunces + JetBrains Mono from Google Fonts |
| `client/src/index.css` | Theme tokens, paper texture, Atelier utility classes |
| `client/src/App.tsx` | `Wordmark` — rotated ink-stamp + Atelier eyebrow |
| `client/src/pages/assistant.tsx` | Greeting, message bubbles, composer |

To port a fix from `starter-external-agent` into this variant, copy non-design files (`src/**`, `client/src/pages/{history,library,settings}.tsx`, etc.) verbatim.
