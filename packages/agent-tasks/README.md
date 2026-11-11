# @teamsuzie/agent-tasks

Supervised agent tasks. One record per piece of agent work: what it is about (an opaque subject such as a matter),
who supervises it, which agent does it, its status, and an append-only timeline of runs, questions, answers,
outputs, requested changes and sign-off.

- `queued → running → in_review → done`, with `blocked` (the agent asks its supervisor something), `failed`
  (retryable) and `cancelled`. Every transition is guarded and recorded.
- `signOffRequired`: the task only reaches `done` when its supervisor signs it off; `signOff` keeps what was
  attested (for example each output with a content hash).
- The store is the queue: `claimNext()` moves the oldest queued task to `running`. The host runs the agent and
  reports back with `finishRun`, `block` or `fail`, and calls `failInterrupted()` at start-up.

```ts
const tasks = new AgentTaskStore({ db });
const t = tasks.create({ subjectType: 'matter', subjectId, title, instructions, ownerId, createdBy, agent: personaId, signOffRequired: true });
```
