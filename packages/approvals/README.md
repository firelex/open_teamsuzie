# @teamsuzie/approvals

Human-in-the-loop approval queue primitive.

## The model

Agents propose actions that need human review before they dispatch. The queue tracks them through a small state machine:

```
        ┌─────────┐
        │ pending │
        └────┬────┘
             │ review()
      ┌──────┴───────┐
      ▼              ▼
 ┌──────────┐   ┌──────────┐
 │ approved │   │ rejected │
 └────┬─────┘   └──────────┘
      │ dispatch()
 ┌────┴────────┐
 ▼             ▼
┌────────────┐ ┌────────┐
│ dispatched │ │ failed │
└────────────┘ └────────┘
```

Terminal states are `rejected`, `dispatched`, and `failed`. A reviewer can optionally supply an `edited_payload` alongside an approve verdict, which replaces the payload before dispatch — this is a parameter of `review()`, not a separate state.

v0.1 ships an in-memory store for tests and demos. A durable Postgres store and a BullMQ worker pattern are tracked in [ROADMAP.md](../../docs/ROADMAP.md) for v0.4.

## API surface

```typescript
import {
  ApprovalQueue,
  InMemoryApprovalStore,
  type ApprovalDispatcher,
} from '@teamsuzie/approvals';

const queue = new ApprovalQueue({ store: new InMemoryApprovalStore() });

// Register one dispatcher per action type.
queue.registerDispatcher<EmailPayload>({
  action_type: 'email.send',
  async dispatch(item) {
    // …send via SendGrid / Resend / your MTA…
    return { success: true };
  },
});

// Agent side: propose an action.
const item = await queue.propose<EmailPayload>({
  subject_id: agentId,
  action_type: 'email.send',
  payload: { to, subject, body },
});

// Human side: approve (optionally editing the payload).
await queue.review(item.id, {
  reviewer_id: userId,
  verdict: 'approve',
  edited_payload: { ...item.payload, subject: 'edited subject' },
});

// Worker / caller: run the dispatcher.
await queue.dispatch(item.id);
```

## Pluggable storage

`ApprovalStore` is an interface with four methods (`create`, `get`, `update`, `list`).
Implementations shipped:

- **`InMemoryApprovalStore`** — for tests and demos; non-durable.

A Postgres / Sequelize implementation will ship in whichever app needs durability
(likely `apps/platform/admin`). Keeping it out of this package means the core has zero DB
coupling and is usable on any stack.

## Pluggable dispatchers

Register one dispatcher per action type:

```typescript
interface ApprovalDispatcher<T> {
  readonly action_type: string;
  dispatch(item: ApprovalItem<T>): Promise<{ success: boolean; error?: string }>;
}
```

The queue routes on `action_type`. Duplicate registrations throw at registration
time, so startup wiring is the single source of truth.

No first-party dispatchers ship in this package yet — the email, Slack, and webhook
dispatchers are app-specific and will land with the apps that need them.

## Scope

**v0.1 (now):** generic state machine, in-memory store, dispatcher registry,
comprehensive tests. 18 tests covering propose / review / dispatch happy paths
plus edge cases (missing dispatcher, invalid state transitions, dispatcher throws,
edited payloads).

**v0.4:** Postgres `ApprovalStore`, email dispatcher as reference, admin UI for
queue inspection.

**v0.5+:** multi-approver workflows, diff UIs on edited payloads, dispatcher retry
helpers.

## Status

v0.1 — **runnable.** Not a direct port of the upstream email-specific queue; this
is a generic reimplementation that lets the email / Slack / webhook specifics land
in the apps that own them rather than coupling this package to any one provider.
