# @teamsuzie/jobs

Reusable async job queue for Team Suzie services.

Use it when a request should return quickly while model invocation, document
conversion, export, indexing, or other background work runs out-of-band.

```ts
import {
  JobQueue,
  SqliteJobStorage,
  createJobWorker,
} from '@teamsuzie/jobs';

const queue = new JobQueue({
  storage: SqliteJobStorage.open({ path: './data/jobs.db' }),
});

await queue.enqueueModelInvocation({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'Summarise this file.' }],
});

const worker = createJobWorker({
  queue,
  handlers: {
    'model.invocation': async (job, ctx) => {
      ctx.progress(10, 'Calling model');
      return { text: '...' };
    },
    'document.processing': async (job, ctx) => {
      ctx.progress(25, 'Converting document');
      return { markdown: '...' };
    },
  },
});

worker.start();
```

The package ships with `InMemoryJobStorage` for tests and single-process
agents, plus `SqliteJobStorage` for local durable queues.
