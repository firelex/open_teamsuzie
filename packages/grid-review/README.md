# @teamsuzie/grid-review

SQLite schema + CRUD for tabular document reviews — rows are documents,
columns are prompted questions, cells are model-generated answers with
citations. Use it when an app needs a spreadsheet-like review of many
documents against the same set of questions (contract review, diligence
Q&A, etc.).

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import {
  REVIEWS_MIGRATIONS,
  ReviewsStore,
  buildCellMessages,
  runCellWithFormat,
  coerceCellOutput,
  createReviewsRouter,
} from '@teamsuzie/grid-review';

const db = openDb({ path: './data/reviews.db', migrations: REVIEWS_MIGRATIONS });
const store = new ReviewsStore({ db });

const review = store.createReview({ workspaceId: 'ws-1', name: 'NDA review' });
const column = store.addColumn({
  reviewId: review.id,
  title: 'Governing law',
  prompt: 'What governing law applies to this agreement?',
  format: 'short_text',
});
const doc = store.addDocument({
  reviewId: review.id,
  externalDocId: 'file-123',
  name: 'nda.docx',
});

for await (const event of runCellWithFormat({
  document: preparedDocument, // from @teamsuzie/citations
  column,
  format: column.format,
  llm: async ({ messages }) => streamFromYourProvider(messages),
})) {
  if (event.type === 'done' && event.formatted) {
    store.upsertCell({
      reviewId: review.id,
      columnId: column.id,
      reviewDocumentId: doc.id,
      status: 'done',
      value: event.formatted,
      citations: JSON.stringify(event.citations),
    });
  }
}

app.use(
  '/api/reviews',
  createReviewsRouter({
    store,
    getWorkspaceId: (req) => req.params.matterId,
    runAdapter: myRunCellAdapter, // RunCellAdapter — omit for CRUD-only, run endpoint 501s
  }),
);
```

A browser-safe subset (no SQLite, no Express) is available from
`@teamsuzie/grid-review/browser` — `runCell`, `runCellWithFormat`,
`buildCellMessages`, `coerceCellOutput`, `ColumnPresetRegistry`, and the
shared types.

## Main exports

- `ReviewsStore` — CRUD for reviews, columns, documents, and cells:
  `createReview`/`updateReview`/`deleteReview`, `addColumn`/`updateColumn`/
  `removeColumn`, `addDocument`/`removeDocument`/`removeDocumentsByExternalId`,
  `upsertCell`/`setCellStatus`/`getCell`/`listCells`, `recoverStaleStreaming`
  (resets cells stuck in `streaming` back to `pending` after a crash/restart),
  and `getReviewSnapshot` (review + columns + documents + cells in one call).
- `REVIEWS_MIGRATIONS` — pass to `openDb({ migrations })`.
- `runCell` / `runCellWithFormat` — stream a model's answer for one cell
  (`token` events, then one `done` or `error`). `runCellWithFormat` also
  coerces the answer to the column's `CellFormat` and does one retry pass
  with a clarifying message if the first attempt doesn't fit the shape.
- `buildCellMessages` — assembles the system/user chat messages for a cell
  run, including the citation protocol from `@teamsuzie/citations` and a
  format-specific answer instruction.
- `coerceCellOutput`, `retryPromptFor` — pure functions that validate/coerce
  raw model text into a `CellFormat`'s canonical shape, and build the retry
  instruction for a given failure reason.
- `ColumnPresetRegistry` — ordered registry of title → `{ prompt, format }`
  presets for autofilling a new column; ships with zero presets, apps
  register their own.
- `createReviewsRouter` — mounts REST endpoints for reviews/columns/
  documents, plus a `POST /:reviewId/run` SSE endpoint that runs all
  pending cells through the host-supplied `runAdapter` (a `RunCellAdapter`)
  and persists results via `store.upsertCell`. Without a `runAdapter` the
  run endpoint returns 501, so CRUD-only mounts (e.g. for tests) are fine.

## `CellFormat`

`'text' | 'short_text' | 'date' | 'yes_no' | 'bullets' | 'money'` — each has
a matching coercion rule in `coerceCellOutput` (e.g. `date` normalizes to
`YYYY-MM-DD`, `money` normalizes to a `$1,500`-style string, `yes_no` to
exactly `"Yes"`/`"No"`).

## Notable behaviour

- `runCell`/`runCellWithFormat` never throw on LLM failure — they yield one
  `error` event and return, so callers always get a terminal event to react
  to.
- The second coercion attempt is final: if it also fails, `done.formatted`
  is `null` and `done.coerce.reason` carries the failure reason for display.
- This package has no RAG/retrieval logic of its own — it just streams the
  model and shapes the answer. Retrieval-backed cell running lives in
  `@teamsuzie/grid-review-rag`, which builds a `RunCellAdapter` on top of
  `@teamsuzie/kb`.
