# @teamsuzie/webmail-browser

Runs `@teamsuzie/webmail-routes` routes in installed Google Chrome through Playwright.

```typescript
import { HumanBehaviour, launchSession, RouteExecutor } from '@teamsuzie/webmail-browser';

const session = await launchSession({ profileDir, headedOffscreen: false, locale: 'en-GB', timezoneId: 'Europe/London' });
const executor = new RouteExecutor({
    page: session.page,
    behaviour: new HumanBehaviour({ rng: Math.random, timeScale: 1, selectAllModifier: 'Meta' }),
    stepTimeoutMs: 8000, stateTimeoutMs: 15000, navigationTimeoutMs: 30000,
});
const { extracted } = await executor.run(route, 'list_inbox', {}, 'live');
```

- **Executor.** Runs an operation's steps exactly as written. A target must match exactly one visible element
  (`target_not_found`, `target_ambiguous`), an `expect` state must hold (`state_not_reached`), required fields must be
  present and well-formed (`extract_invalid`), and the recipients shown must equal the draft's before Send
  (`recipients_mismatch`). Each is a `RouteError` naming the operation and step. Landing on a sign-in host is a
  `NeedsLoginError`; a page that will not load is a `NavigationError` — neither is a route problem.
- **Test mode** (`run(..., 'test')`) stops before the step marked `commits` and runs `test_end` instead.
- **Behaviour.** Real mouse and keyboard events only: curved mouse paths to a random point inside the target, key-by-key
  typing with varying delays, pauses between steps and for reading. `timeScale: 0` removes the delays (tests).
- **`VolumeLimiter`** waits so message opens and sends stay within per-minute, per-hour and spacing limits.
- **Session.** `launchSession` opens the account's persistent profile (created owner-only) in installed Chrome,
  headless or headed off-screen, without `--enable-automation`, with `navigator.webdriver` false and a user agent
  without "HeadlessChrome". `loginHandoff` opens a visible window on the same profile for the user to sign in.
- **Capture.** `capturePage` gives the URL, the accessibility snapshot and unnamed interactive elements (for
  relearning). `computeFingerprint` hashes the layout (landmarks, toolbars, buttons, links outside lists), ignoring
  message content and counts.
- **Testing.** `@teamsuzie/webmail-browser/testing` serves a small Gmail-like app on `https://mail.example.test` by
  request interception, with a matching `fixtureRoute()`. Tests need Google Chrome installed.
