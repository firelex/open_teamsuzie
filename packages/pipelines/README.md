# @teamsuzie/pipelines

Stage-based workflows over opaque `(subject_type, subject_id)` refs.
Same shape serves sales, hiring, support, procurement, onboarding,
legal intake — the package carries no domain language.

## Exports

- `PIPELINES_MIGRATIONS` — pass to `openDb({ migrations })`.
- `PipelinesStore` — `new PipelinesStore({ db, idFactory?, now? })`.

## Org scoping

Pipelines belong to a single `orgId`; placements + transitions inherit
it from the pipeline so reads are always implicitly org-scoped. The
subject ref is opaque — no FK to other packages — so hosts can place
records, candidates, tickets, anything they have an id for.

## Usage

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { PIPELINES_MIGRATIONS, PipelinesStore } from '@teamsuzie/pipelines';

const db = openDb({ path: 'app.db', migrations: PIPELINES_MIGRATIONS });
const pipelines = new PipelinesStore({ db });

const p = pipelines.createPipeline({ orgId: 'org-1', key: 'hire', name: 'Hiring', subjectType: 'candidate' });
const applied = pipelines.addStage({ pipelineId: p.id, key: 'applied', name: 'Applied' });
const interview = pipelines.addStage({ pipelineId: p.id, key: 'interview', name: 'Interview' });

pipelines.placeSubject({ pipelineId: p.id, subject: { type: 'candidate', id: 'c-1' }, stageId: applied.id });
pipelines.moveSubject({ pipelineId: p.id, subject: { type: 'candidate', id: 'c-1' }, toStageId: interview.id });
pipelines.listTransitions({ pipelineId: p.id, subject: { type: 'candidate', id: 'c-1' } });
```
