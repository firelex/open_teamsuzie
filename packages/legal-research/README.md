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
      courtListenerApiKey: process.env.COURTLISTENER_API_KEY,
      legifranceApiKey: process.env.LEGIFRANCE_API_KEY,
      judilibreApiKey: process.env.JUDILIBRE_API_KEY,
      indianKanoonApiKey: process.env.INDIAN_KANOON_API_KEY,
    }),
  ],
});
```

## Environment variables

The factory accepts a config object; pass each provider's API key as a string,
or omit to disable that provider. Recommended env-var convention:

| Variable                   | Provider                  |
|----------------------------|---------------------------|
| `COURTLISTENER_API_KEY`    | US — CourtListener        |
| `LEGIFRANCE_API_KEY`       | France — Légifrance       |
| `JUDILIBRE_API_KEY`        | France — Judilibre        |
| `INDIAN_KANOON_API_KEY`    | India — Indian Kanoon     |

All other providers are key-free (rate-limited or public).
