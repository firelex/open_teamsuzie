# @teamsuzie/market-intel

Provider-agnostic market/news intelligence search and watch-run
persistence. Use it when an app needs to periodically search the web for
news about a subject (a company, a matter, a topic) and keep a record of
what was found.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import {
  MARKET_INTEL_MIGRATIONS,
  MarketWatchStore,
  TavilyMarketSearchProvider,
  NoOpMarketSearchProvider,
} from '@teamsuzie/market-intel';

const db = openDb({ path: './data/app.db', migrations: MARKET_INTEL_MIGRATIONS });

const provider = process.env.TAVILY_API_KEY
  ? new TavilyMarketSearchProvider({ apiKey: process.env.TAVILY_API_KEY })
  : new NoOpMarketSearchProvider();

const watchStore = new MarketWatchStore({ db, provider });

const { run, items } = await watchStore.run({
  subject: { id: 'acme-corp', name: 'Acme Corp' },
  categories: ['litigation', 'regulatory'],
  queries: {
    litigation: 'Acme Corp lawsuit',
    regulatory: 'Acme Corp SEC filing',
  },
  createdBy: 'alice@example.com',
  recencyDays: 14,
  limitPerCategory: 5,
});

watchStore.listRuns({ subjectId: 'acme-corp' });
watchStore.listItems({ subjectId: 'acme-corp', runId: run.id });
```

## Main exports

- `MarketWatchStore` — `run` (searches each category's query through the
  provider, persists a `market_watch_runs` row plus one `market_watch_items`
  row per hit, and marks the run `completed` or `failed`), `getRun`,
  `listRuns`, `listItems`.
- `MARKET_INTEL_MIGRATIONS` — pass to `openDb({ migrations })`, creates
  `market_watch_runs` and `market_watch_items`.
- `MarketSearchProvider` — the interface a search backend implements:
  `providerName` plus `search(query, opts?)`.
- `TavilyMarketSearchProvider` — calls the Tavily `/search` API; returns
  `{ notConfigured: true }` with no hits when constructed without an
  `apiKey` rather than throwing.
- `NoOpMarketSearchProvider` — always returns `{ hits: [], notConfigured: true }`;
  useful as a default when no provider is configured.

## Configuration

- `TavilyMarketSearchProviderOptions.apiKey` — required to actually search;
  `baseUrl` defaults to `https://api.tavily.com`.
- `MarketWatchRunInput.recencyDays` (clamped 1–365, default 14) and
  `limitPerCategory` (clamped 1–20, default 5) bound each category's query.
- `MarketWatchRunInput.rationaleFor` lets a caller override the default
  "Matched \<category\> watch for \<subject\>" relevance text stored per item.

## Notable behaviour

- A run's `notConfigured` flag is set true if any category's provider call
  came back unconfigured, but the run still completes and persists hits
  from categories that did return results.
- Item inserts use `INSERT OR IGNORE`, so re-running a watch with
  overlapping hits (same run) doesn't duplicate rows.
- On a thrown provider error mid-run, the run row is marked `status =
  'failed'` with the error message, and the categories already searched
  keep their persisted items.
