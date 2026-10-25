# @teamsuzie/webmail-learn

Relearns one broken operation of a webmail route (`@teamsuzie/webmail-routes`) from the live page.

```typescript
import { openAiCompatibleRouteModel, RouteLearner } from '@teamsuzie/webmail-learn';

const learner = new RouteLearner({
    model: openAiCompatibleRouteModel({ baseUrl: 'http://gpu-box:8000/v1', model: 'qwen3-72b', maxTokens: 8000 }),
    executor, maxSubmissions: 3, maxToolCalls: 30, log: console.log, record: saveRound, now: () => new Date(),
});
const outcome = await learner.relearn({ route, operation: 'compose_send', goal, outputs, params, checkResult });
```

One `relearn` call is one attempt. The operation is first run in test mode (nothing is sent; drafts are discarded).
If it fails with a `RouteError`, the model gets a plain-English, self-contained brief (the goal and outputs, the
failure with what was found on the page, the step, target and field rules, the current steps and states, and the
page: URL, accessibility tree, unnamed elements and an attribute outline) and works with tools on the live page:

| Tool | What it does |
|---|---|
| `try_target` | How many visible elements a target matches, described; or the nearest candidates |
| `check_state` | Whether a state (named, or proposed in full) holds now, and why not |
| `try_extract` | The first records an extract reads, or the exact field error |
| `run_operation` | A full test-mode run of a candidate from a clean inbox (never commits; checks the discard closed the draft) |
| `submit_repair` | The final answer: checked against the rules, a test-mode run, and the other operations sharing a changed state |

The outcome is `{ ok: true, changed: false }` when the operation already works; `{ ok: true, changed: true, route }`
for an accepted repair (new `route_version`, `learned_by: learner:<model>`, fresh layout fingerprint, and `untested`
operations to check next); or `{ ok: false, reason }` when the tool-call or submission budget runs out or the model
stops calling tools. Every model turn and tool call is passed to `record`. Sign-outs and page-load failures are
thrown.

`openAiCompatibleRouteModel` talks to any OpenAI-compatible runtime with tool calls, through `@teamsuzie/models`.
