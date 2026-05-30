# @teamsuzie/legal-research

Legal-research tool surface for `@teamsuzie/agent-runtime` apps.

## Usage

```typescript
import { startAgent } from '@teamsuzie/agent-runtime/server';
import { legalResearchExtension } from '@teamsuzie/legal-research';

startAgent({
  manifestPath: './agent.json',
  extensions: [
    legalResearchExtension({
      courtListenerToken: process.env.COURTLISTENER_TOKEN,
      legifranceClientId: process.env.LEGIFRANCE_CLIENT_ID,
      legifranceClientSecret: process.env.LEGIFRANCE_CLIENT_SECRET,
      judilibreApiKey: process.env.JUDILIBRE_API_KEY,
      indianKanoonApiKey: process.env.INDIAN_KANOON_API_KEY,
    }),
  ],
});
```

## Environment variables

The factory accepts a config object; pass each provider's credential as a string,
or omit to disable that provider. Recommended env-var convention:

| Variable                   | Provider                                         |
|----------------------------|--------------------------------------------------|
| `COURTLISTENER_TOKEN`      | US — CourtListener                               |
| `LEGIFRANCE_CLIENT_ID`     | France — Légifrance, OAuth client credentials    |
| `LEGIFRANCE_CLIENT_SECRET` | France — Légifrance, OAuth client credentials    |
| `JUDILIBRE_API_KEY`        | France — Judilibre                               |
| `INDIAN_KANOON_API_KEY`    | India — Indian Kanoon                            |

All other providers are key-free (rate-limited or public).
