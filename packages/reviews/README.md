# @teamsuzie/reviews

SQLite schema and CRUD for "reviews as data": named column templates (system-seeded or user-created) and the tabular reviews (rows of free-form records) instantiated from them, for the agent-runtime Reviews module. Use it when a host wants users to define a column set once and reuse it to build simple, row-based reviews — this package stores structure and data only; it does not run any model to fill in cells (see `@teamsuzie/grid-review` for that).

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { ReviewsStore, REVIEWS_MIGRATIONS, createReviewsRouter } from '@teamsuzie/reviews';

const db = openDb({ path: './data/app.db', migrations: REVIEWS_MIGRATIONS });
const store = new ReviewsStore({ db });

// Seed the system catalog at startup — re-running replaces/removes stale ids.
store.seedSystemTemplates([
  {
    id: 'contract-intake',
    name: 'Contract intake',
    description: 'First-pass review of an incoming contract',
    columns: [
      { id: 'parties', title: 'Parties', prompt: 'List the contracting parties.', format: 'text' },
      { id: 'term', title: 'Term', prompt: 'What is the contract term?', format: 'date' },
    ],
  },
]);

const review = store.createUserReview({
  ownerId: 'user@example.com',
  name: 'Vendor agreement — Acme',
  templateId: 'contract-intake',
});

app.use(
  '/api/reviews',
  requireAuth,
  createReviewsRouter({ store, getOwnerId: (req) => req.session?.user?.email ?? null }),
);
```

## Main exports

- `ReviewsStore` — templates (`upsertSystemTemplate`, `seedSystemTemplates`, `seedAsUserIfEmpty`, `createUserTemplate`, `updateUserTemplate`, `deleteUserTemplate`, `getTemplate`, `listTemplatesVisible`, `listTemplatesBySource`) and reviews (`createUserReview`, `updateUserReview`, `deleteUserReview`, `getReview`, `listReviewsVisible`).
- `createReviewsRouter` — REST endpoints: `GET/POST /templates`, `PATCH/DELETE /templates/:id` (user-owned only — system templates aren't editable through this router), `GET/POST /`, `GET/PATCH/DELETE /:id`.
- `REVIEWS_MIGRATIONS` — the `review_templates`, `reviews`, and `review_seeds_applied` table migrations.
- Types: `ReviewTemplate`, `ReviewColumn`, `CellFormat` (`'text' | 'number' | 'boolean' | 'date' | 'tags' | 'currency'`), `Review`, plus the `Create*Input`/`Update*Input`/`List*Options` shapes.

## Notable behaviour

- `seedSystemTemplates` is the only way to remove a system template: it upserts every template in the given array and deletes any existing system template whose id isn't in that set, so "the code is the source of truth."
- A row's cell values are stored as a free-form `Record<string, unknown>` keyed however the host chooses (typically by column id) — this package does not validate cell contents.
- `listTemplatesVisible`/`listReviewsVisible` take `{ ownerId, includeArchived? }`: user rows owned by someone else are excluded; system templates are always included regardless of owner.
- `seedAsUserIfEmpty(seedKey, items, ownerId)` is a copy-on-first-run path for user-owned starter templates: it inserts with `INSERT OR IGNORE` and records `seedKey` in `review_seeds_applied` so later calls (even after the user deletes everything) are no-ops — distinct from the always-authoritative `seedSystemTemplates`.

Used by `@teamsuzie/agent-runtime`, which also wires the Reviews feature into its manifest schema.
