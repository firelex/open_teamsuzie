# @teamsuzie/agent-events

Generic, host-agnostic types for structured updates (`AgentUpdate`) that an orchestration layer emits and a user-facing presenter renders, plus default action menus per update kind.

Use it when you're building an agent orchestration layer and want a typed, presenter-friendly shape for progress/question/result/error updates instead of free text, without baking in any host's specific action vocabulary.

```ts
import {
  defaultActionsFor,
  resolveActions,
  type AgentUpdate,
} from '@teamsuzie/agent-events';

const update: AgentUpdate = {
  kind: 'result',
  summary: 'Draft complete',
  subjectId: 'matter-123',
  severity: 'info',
};

// Use the built-in defaults for this update kind...
const actions = defaultActionsFor(update);
// -> [{ id: 'approve', ... }, { id: 'ask_for_changes', ... }]

// ...or let the caller's own actions win when present.
const resolved = resolveActions({
  ...update,
  actions: [{ id: 'open_preview', label: 'Open preview', intent: 'open_preview' }],
});
```

## Main exports

- `AgentUpdate` — `{ kind, summary, details?, severity?, subjectId, correlationId?, actions? }`. `kind` is one of `'progress' | 'question' | 'result' | 'error'`; `severity` is `'info' | 'warning' | 'blocking'`.
- `AgentAction` — `{ id, label, intent, payload? }`.
- `AgentActionIntent` — built-in intents (`'continue' | 'approve' | 'reject' | 'run_tests' | 'replan' | 'ask_for_changes'`) plus any other string, so hosts can add their own (e.g. `'open_preview'`, `'push'`).
- `defaultActionsFor(update)` — returns the generic default action menu for `update.kind` (result → approve/ask_for_changes, progress → continue/replan, question → replan, error → continue/replan).
- `resolveActions(update)` — returns `update.actions` when non-empty, otherwise falls back to `defaultActionsFor(update)`.

## Notable behaviour

- This package is intentionally generic: it has no opinion on agent identity (Claude, Codex, a local model, …) or on a host's subject vocabulary (project, matter, chat, …). `subjectId` is an opaque string the host assigns meaning to.
- `defaultActionsFor` never returns host-specific intents like `open_preview` or `push` — those are added by the consuming app via `update.actions`.
- `AgentUpdate.subjectId` is meant to mirror `DepartmentEvent.subjectId` in `@teamsuzie/events` when both are used by the same host.
