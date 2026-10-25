# @teamsuzie/webmail-routes

Routes for driving a webmail page (Gmail, Outlook) as data. A route says, for each operation (`list_inbox`,
`open_message`, `search`, `compose_send`, …), which steps to take: `goto`, `click`, `fill`, `type`, `press`, `scroll`,
`wait_for`, `extract`, `verify_recipients`. Nothing in a route runs as code; `@teamsuzie/webmail-browser` runs it.

```typescript
import { assertValidRoute } from '@teamsuzie/webmail-routes';

const route = assertValidRoute(JSON.parse(text)); // throws RouteValidationError listing every problem
```

- Targets are accessibility locators (`role` + `name` or `name_pattern`); `css` only for elements with no accessible
  name. A target must match exactly one visible element unless it says `each: true`. `within` scopes to a named state's
  `container`.
- States are named page conditions (`url_matches`, `visible`). A step's `expect` names the state that must hold after it.
- Values come only from the fixed placeholders (`$draft.to`, `$draft.subject`, `$query`, `$message_id`, …).
- `commits: true` marks the irreversible step (Send). An operation with one needs `test_end` (e.g. discard the draft),
  which runs in its place in test mode.
- The validator rejects unknown keys, keys such as `script` or `eval`, `goto` to a host outside `domains`, CSS that
  depends on generated numeric ids (`#116-group`), field patterns without exactly one capture group, and routes over 64KB.
- Keys: a `press` (or `then_press`) may only use harmless keys: navigation keys, the new-message, reply and
  search shortcuts (N, R, C, `/`, ControlOrMeta+N/R, ControlOrMeta+Shift+R). A key that sends (ControlOrMeta+Enter,
  Alt+S) may only be pressed as its own step marked `commits`, so test mode never sends by keyboard. Keys that
  archive, delete or mark mail (E, Delete, U, …) are rejected (`keyKind`).
- `nextRouteVersion` gives `YYYY-MM-DD.N` versions. `minimalRoute()` is a small valid route for tests.
