# @teamsuzie/webmail-learn

Relearns one broken operation of a webmail route (`@teamsuzie/webmail-routes`) from the live page.

```typescript
import { openAiCompatibleRouteModel, RouteLearner } from '@teamsuzie/webmail-learn';

const learner = new RouteLearner({
    model: openAiCompatibleRouteModel({ baseUrl: 'http://gpu-box:8000/v1', model: 'qwen3-72b', maxTokens: 8000, jsonMode: true }),
    executor, maxStepFixes: 5, log: console.log, now: () => new Date(),
});
const outcome = await learner.relearn({ route, operation: 'compose_send', goal, outputs, params, checkResult });
```

One `relearn` call is one attempt. Each round runs the operation in test mode (nothing is sent; drafts are
discarded). When it fails with a `RouteError`, the page is captured (URL, accessibility snapshot, unnamed
interactive elements) and the model gets a plain-English, self-contained prompt: the operation's goal and outputs,
the failure, the step and target rules, the current steps and states, the page, and why its earlier replies were
unusable. Its JSON reply replaces the operation's steps and adds or changes states; it must pass
`validateRoute` before it is tried.

The outcome is `{ ok: true, changed: false }` when the operation already works; `{ ok: true, changed: true, route }`
when a repair passed, along with every other operation that uses a state it changed (the route gets a new
`route_version`, `learned_by: learner:<model>` and a fresh layout fingerprint); or `{ ok: false, reason }` after
`maxStepFixes` model replies, or when the repair breaks another operation. Sign-outs and page-load failures are
thrown.

`openAiCompatibleRouteModel` talks to any OpenAI-compatible runtime through `@teamsuzie/models`; `jsonMode` adds
`response_format: json_object` for runtimes that support it. Prompts are text only (no screenshots).
