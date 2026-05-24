# starter-external-agent-console

A **terminal/phosphor** themed variant of [`starter-external-agent`](../starter-external-agent/README.md). Same backend, same UI primitives — distinct visual identity, ready to fork.

## Design

- **Family**: JetBrains Mono throughout, weight variation only.
- **Palette**: graphite background, faint phosphor-green foreground, single phosphor accent, amber destructive.
- **Voice**: `$ slug --help`, `[ready]`, `[connected]`, `attach`, `exec ↵`, `sigint`. The agent is a process at a prompt.
- **Distinctive details**: blinking caret on the wordmark and greeting, CRT scanline overlay on the page background and on prompt-card hover, `[tag]` brackets for status, square corners everywhere, pulsing dot on the connection indicator.

Best fit: developer tools, devops agents, code review, log triage — anywhere the user is already at home in a shell.

## When to fork this vs the base starter

Fork this when your agent's audience **lives in a terminal**. The terseness, the square corners, and the absence of pleasantries match a workflow where output is information and the chrome should disappear.

If the agent's output is mostly prose, fork [`starter-external-agent-atelier`](../starter-external-agent-atelier/README.md). If it's premium B2B/enterprise, fork [`starter-external-agent-glasshouse`](../starter-external-agent-glasshouse/README.md). For PE-suite visual continuity, fork [`starter-external-agent-counsel`](../starter-external-agent-counsel/README.md). For TeamSuzie brand continuity (Electric Violet), fork [`starter-external-agent-teamsuzie`](../starter-external-agent-teamsuzie/README.md).

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
| `client/index.html` | Loads JetBrains Mono from Google Fonts |
| `client/src/index.css` | Theme tokens, CRT scanlines, caret + pulse animations, `console-*` utility classes |
| `client/src/App.tsx` | `Wordmark` — pulse dot + `> slug_` with blinking caret |
| `client/src/pages/assistant.tsx` | Header, greeting (shell-style help), bubbles (`$` prefix + `[tag]`), composer |

To port a fix from `starter-external-agent` into this variant, copy non-design files (`src/**`, `client/src/pages/{history,library,settings}.tsx`, etc.) verbatim.
