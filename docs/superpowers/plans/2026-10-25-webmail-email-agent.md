# Webmail Email Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents read, search and send the user's Gmail/Outlook mail through a local queue, with one browser-driving handler per account that runs learned, validated routes and relearns them automatically with a local model.

**Architecture:** Four packages (`webmail-routes` → `webmail-browser` → `webmail-learn` → `email-webmail`) and one service (`apps/agents/email-agent`). Routes are JSON data run by a strict Playwright executor through a human-like behaviour layer. The service owns a SQLite job queue, an approvals store, operation health, alerts and a new-mail store, and exposes MCP tools to agents and admin HTTP endpoints to a CLI.

**Tech Stack:** TypeScript (NodeNext ESM), pnpm workspaces, vitest, `playwright-core` with installed Google Chrome (`channel: 'chrome'`), `@modelcontextprotocol/sdk` 1.29 (streamable HTTP server), `zod` 3, `express` 5, `better-sqlite3` via `@teamsuzie/db-sqlite`, `@teamsuzie/jobs`, `@teamsuzie/approvals`, `@teamsuzie/models`, `@teamsuzie/email`.

**Spec:** `docs/superpowers/specs/2026-10-25-webmail-email-agent-design.md`

## Global Constraints

- No fallbacks: no merged selector lists, no silent catches, no `?? default` hiding a missing required value. Missing config or a missing route file is a startup error naming the value.
- Every LLM prompt is plain, self-contained English.
- Package layout matches `packages/email-simulator` (ESM, `tsc` build to `dist`, `vitest run`, `src/**/*.test.ts`, README in the style of the other `email-*` packages).
- Targets resolve to exactly one visible element unless `each: true`.
- Test mode never runs a step marked `commits: true`.
- Automated tests never touch live Gmail/Outlook. Browser tests use local fixture pages served from `127.0.0.1`, and installed Chrome headless.
- The MCP and admin HTTP servers bind `127.0.0.1` only.

## Deviations from the spec (decided while planning)

1. **No screenshots to the learner.** `@teamsuzie/models` messages are text only. The learner sends URL, accessibility snapshot and the reduced DOM of unnamed elements. `learner.sendScreenshots` is not implemented. Failure screenshots are still saved locally.
2. **New-mail feed uses its own SQLite store**, not `@teamsuzie/email-sync`'s `MailSync`. `MailSync` needs a provider history cursor (`changesSince`), which a webmail page does not offer. `check_inbox` records inbox summaries it has not seen before with an increasing sequence number; `list_new_mail` reads after a cursor.
3. **`check_sent` is tested in the canary with the subject of an existing Sent message** if one exists; an empty result list is valid in test mode.

## Review Focus

1. A target that matches two visible elements (e.g. two "Send" buttons when a reply and a compose are both open) must fail `target_ambiguous`, never click the first. → Task 3 test.
2. A send whose recipient chips differ from the draft (autocomplete picked a different address) must stop before Send with `recipients_mismatch`. → Task 3 test.
3. A provider sign-in redirect in the middle of an operation must surface as `needs_login`, not as a route error that triggers relearning. → Task 3 test.
4. A model reply that is not JSON, or JSON that fails validation, must count as a failed fix and be fed back, not crash the learner. → Task 5 test.
5. A send to recipients outside every allow rule, or from an agent with no rule, must go to approval, never be sent. → Task 8 test.

---

## File Structure

```
packages/webmail-routes/
  src/types.ts            Route, PageState, Target, Step, Operation, ExtractSpec, FieldSpec, OperationName, Params
  src/placeholders.ts     PLACEHOLDERS set, findPlaceholders(), substitute()
  src/validate.ts         validateRoute(route): string[] ; assertValidRoute()
  src/version.ts          nextRouteVersion(previous, date)
  src/index.ts
packages/webmail-browser/
  src/errors.ts           RouteError (+codes), NeedsLoginError, NavigationError
  src/behaviour.ts        Behaviour interface, HumanBehaviour
  src/limiter.ts          VolumeLimiter
  src/locate.ts           buildLocator(), resolveOne(), resolveAll()
  src/extract.ts          readField(), checkFormat()
  src/executor.ts         RouteExecutor.run(operation, params, mode)
  src/capture.ts          capturePage(), computeFingerprint()
  src/session.ts          launchSession(), loginHandoff()
  src/index.ts
  test/fixtures/          gmail-like.html, outlook-like.html (+ variants), server.ts
packages/webmail-learn/
  src/model.ts            RouteModel interface, openAiCompatibleRouteModel()
  src/prompt.ts           buildRepairPrompt()
  src/parse.ts            parseRepair()
  src/learner.ts          RouteLearner.relearn()
  src/index.ts
packages/email-webmail/
  src/goals.ts            OPERATION_GOALS, OPERATION_OUTPUTS
  src/routes/gmail.ts     seed route
  src/routes/outlook.ts   seed route
  src/route-store.ts      FileRouteStore
  src/client.ts           WebmailEmailClient
  src/canary.ts           runCanary()
  src/index.ts
apps/agents/email-agent/
  src/config.ts           loadConfig() (zod)
  src/db.ts               openAgentDb() migrations
  src/approval-store.ts   SqliteApprovalStore
  src/policy.ts           evaluateSendPolicy()
  src/health.ts           HealthStore (per account+operation state)
  src/alerts.ts           AlertStore, Notifier, MacNotifier
  src/new-mail.ts         NewMailStore
  src/jobs.ts             job kinds, param schemas, submitJob(), jobView()
  src/handler.ts          AccountHandler
  src/mcp.ts              createMcpServer()
  src/admin.ts            admin router
  src/service.ts          startService()
  src/cli.ts              CLI entry
  email-agent.config.example.json
```

---

### Task 1: `@teamsuzie/webmail-routes` — schema, placeholders, validator

**Files:** create all of `packages/webmail-routes/*` (package.json, tsconfig.json, vitest.config.ts, README.md, src/*). Tests: `src/validate.test.ts`, `src/placeholders.test.ts`, `src/version.test.ts`.

**Interfaces (produced):**
```ts
export type ProviderKey = 'gmail' | 'outlook';
export const OPERATION_NAMES = ['read_account','list_inbox','open_message','read_thread','search','compose_send','reply','check_sent'] as const;
export type OperationName = typeof OPERATION_NAMES[number];
export interface Target { role?: string; name?: string; name_pattern?: string; css?: string; within?: string; has?: Target; each?: boolean }
export interface PageState { url_matches?: string; visible: Target[]; container?: Target }
export type FieldSource = 'text' | 'name' | `attr:${string}`;
export interface FieldSpec { target?: Target; from: FieldSource; pattern?: string; format: 'email'|'emails'|'date'|'nonempty'|'id'|'text'|'flag'; required: boolean }
export interface ExtractSpec { items?: Target; fields: Record<string, FieldSpec> }
export type Step =
  | { goto: 'home' | string; expect?: string }
  | { click: Target; commits?: boolean; expect?: string }
  | { fill: Target; value: string; expect?: string }
  | { type: Target; value: string; each_address?: boolean; then_press?: string; expect?: string }
  | { press: string; expect?: string }
  | { scroll: Target | 'page' }
  | { wait_for: string }
  | { extract: ExtractSpec; as: string }
  | { verify_recipients: { to: Target; cc?: Target; bcc?: Target; from: FieldSource } };
export interface Operation { steps: Step[]; test_end?: Step[] }
export interface Route { schema_version: 1; provider: ProviderKey; route_version: string; learned_by: string; learned_at: string; domains: string[]; login_domains: string[]; home_url: string; fingerprint: string | null; states: Record<string, PageState>; operations: Record<OperationName, Operation> }
export type Params = Partial<Record<PlaceholderName, string>>;
export const PLACEHOLDERS = ['$draft.to','$draft.cc','$draft.bcc','$draft.subject','$draft.body','$query','$message_id','$thread_id','$account'] as const;
export function findPlaceholders(text: string): string[];
export function substitute(text: string, params: Params, opts: { encode: 'none' | 'url' | 'css' }): string; // throws on a placeholder with no value
export function validateRoute(route: unknown): string[];        // [] when valid
export function assertValidRoute(route: unknown): Route;        // throws RouteValidationError listing errors
export function nextRouteVersion(previous: string | null, today: Date): string; // YYYY-MM-DD.N
```

**Validator rules (each with a test):** schema_version 1; provider gmail|outlook; route_version `^\d{4}-\d{2}-\d{2}\.\d+$`; domains & login_domains non-empty hostnames; home_url https on a listed domain; every operation in OPERATION_NAMES present with ≥1 step; each step has exactly one action key from the fixed set and no unknown keys; `goto` string must be `home` or an https URL on a listed domain (placeholders allowed in path/hash); targets: at least one of role/css; `name` and `name_pattern` not both; `name_pattern` compiles; `css` ≤512 chars and no generated numeric ids (`#123`, `#116-label`, `[aria-labelledby="116-label"]`, `[for="123"]`); `within`/`expect`/`wait_for` reference defined states; `within` state has `container`; `has` validated recursively and may not use `within`; placeholders only from PLACEHOLDERS; fields: `pattern` compiles and has exactly one capture group; ops with a `commits: true` step must have non-empty `test_end`, and `test_end` has no commit step; banned keys `script|eval|function|code|js` anywhere; total JSON ≤ 64KB.

- [ ] Write failing tests for each rule (one valid minimal route fixture + one mutation per rule), plus placeholders (`substitute` with url/css encoding, throws on missing) and `nextRouteVersion` (same day increments, new day resets to .1).
- [ ] Run `pnpm --filter @teamsuzie/webmail-routes test` → FAIL.
- [ ] Implement.
- [ ] Run tests + `typecheck` → PASS.
- [ ] Commit `feat(webmail-routes): route schema, placeholders and validator`.

### Task 2: `@teamsuzie/webmail-browser` — behaviour, limiter, locate, extract

**Files:** package scaffolding with dependencies `@teamsuzie/webmail-routes`, `playwright-core`; `src/errors.ts`, `src/behaviour.ts`, `src/limiter.ts`, `src/locate.ts`, `src/extract.ts`; fixtures `test/fixtures/server.ts` (node `http` static server on 127.0.0.1, random port), `test/fixtures/mail.html`; tests `src/locate.test.ts`, `src/extract.test.ts`, `src/limiter.test.ts`, `src/behaviour.test.ts`; `test/browser.ts` helper launching headless Chrome (`chromium.launch({ channel: 'chrome', headless: true })`).

**Interfaces (produced):**
```ts
export type RouteErrorCode = 'target_not_found'|'target_ambiguous'|'state_not_reached'|'extract_invalid'|'recipients_mismatch';
export class RouteError extends Error { code: RouteErrorCode; operation: string; stepIndex: number; detail: string }
export class NeedsLoginError extends Error {}           // page on a login domain
export class NavigationError extends Error {}           // network / navigation timeout
export interface Behaviour { click(page: Page, el: Locator): Promise<void>; typeText(page: Page, el: Locator, text: string): Promise<void>; clearAndType(page: Page, el: Locator, text: string): Promise<void>; press(page: Page, key: string): Promise<void>; scroll(page: Page, el: Locator | null): Promise<void>; betweenSteps(): Promise<void>; reading(chars: number): Promise<void> }
export interface HumanBehaviourOptions { rng: () => number; timeScale: number } // timeScale 0 in tests
export class HumanBehaviour implements Behaviour
export interface VolumeLimits { opensPerMinute: number; opensPerHour: number; minSecondsBetweenSends: number }
export class VolumeLimiter { constructor(limits: VolumeLimits, now?: () => number, sleep?: (ms: number) => Promise<void>); acquire(kind: 'open' | 'send'): Promise<void> }
export function buildLocator(page: Page, target: Target, states: Record<string, PageState>, params: Params): Locator;
export function resolveOne(page, target, states, params, timeoutMs, ctx: { operation: string; stepIndex: number }): Promise<Locator>; // RouteError target_not_found | target_ambiguous
export function resolveAll(page, target, states, params, timeoutMs): Promise<Locator[]>;          // may be empty
export function readField(el: Locator, spec: FieldSpec): Promise<string | null>;
export function checkFormat(value: string | null, spec: FieldSpec): boolean;
```

Behaviour details: click = move mouse along a 12–25 point quadratic Bézier from the last position to a random point inside the middle 60% of the bounding box, short pause, `mouse.down/up`. typeText = `keyboard.type` one char at a time with delay 40–160ms × timeScale and a 300–900ms pause on ~4% of chars. clearAndType = click, `Meta+A` (darwin) / `Control+A`, `Backspace`, typeText. betweenSteps 400–1400ms; reading = min(8000, 800 + chars × 8)ms; all × timeScale. Locate: role → `getByRole(role, { name, exact: true })` or `{ name: RegExp(name_pattern,'i') }`; css → `locator(css)`; `has` → `.filter({ has })`; `within` → scope to the state's container (itself resolved with resolveOne); always `.filter({ visible: true })`. resolveOne polls until ≥1 match or timeout; >1 → `target_ambiguous`.

- [ ] Failing tests: role+name exact match; ambiguous (two "Send" buttons) → `target_ambiguous`; hidden element ignored; `within` scoping; `has` filter; css placeholder substitution with CSS escaping; readField text/name/attr + pattern; checkFormat for each format; limiter waits (fake clock + fake sleep) for per-minute and send spacing; behaviour click/type actually reaches a fixture input with timeScale 0.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(webmail-browser): human-like behaviour, volume limiter, strict locators and field extraction`.

### Task 3: `@teamsuzie/webmail-browser` — executor, capture, fingerprint, session

**Files:** `src/executor.ts`, `src/capture.ts`, `src/session.ts`, `src/index.ts`, README; fixtures `test/fixtures/gmail-like.html` (inbox grid, message view, compose dialog with recipient chips, Sent view, "Account" button with email), `test/fixtures/login.html` (served under a host alias `login.localhost`), `test/fixtures/routes.ts` (a valid Route targeting the fixture); tests `src/executor.test.ts`, `src/capture.test.ts`.

**Interfaces (produced):**
```ts
export interface StepRecord { index: number; action: string; ms: number }
export interface OperationResult { extracted: Record<string, unknown>; steps: StepRecord[] }
export interface ExecutorOptions { page: Page; behaviour: Behaviour; stepTimeoutMs: number; stateTimeoutMs: number }
export class RouteExecutor {
  constructor(opts: ExecutorOptions);
  run(route: Route, operation: OperationName, params: Params, mode: 'live' | 'test'): Promise<OperationResult>;
  stateHolds(route: Route, state: string): Promise<boolean>;
}
export interface PageCapture { url: string; aria: string; unnamed: string[] }
export function capturePage(page: Page): Promise<PageCapture>;
export function fingerprintFromAria(aria: string): string;       // sha256:...
export function computeFingerprint(page: Page): Promise<string>;
export interface SessionOptions { profileDir: string; headedOffscreen: boolean; locale: string; timezoneId: string }
export interface Session { context: BrowserContext; page: Page; close(): Promise<void> }
export function launchSession(opts: SessionOptions): Promise<Session>;
export function loginHandoff(opts: { profileDir: string; startUrl: string; isComplete: (page: Page) => Promise<boolean>; timeoutMs: number; pollMs: number; locale: string; timezoneId: string }): Promise<'completed' | 'timed_out'>;
```

Executor semantics: before each step and after each `expect`, if the page host is in `route.login_domains` throw `NeedsLoginError`; `goto` 'home' → `route.home_url`, else substitute with url encoding; navigation failures/timeouts → `NavigationError`; `expect` waits for the state (url regex + every `visible` target resolves exactly one) → `state_not_reached`; `fill` → clearAndType; `type` with `each_address` splits on `,`/`;`, trims, types each and presses `then_press`; `extract` → if `items`, resolveAll then per item read fields relative to item, else one record from page; required field missing or format fails → `extract_invalid` naming field; result stored under `as`; `verify_recipients` reads each chip with `from`, pulls emails via regex, compares lowercase sets to `$draft.to/cc/bcc` → `recipients_mismatch`; `click` with `commits` in test mode stops the main steps and runs `test_end`; in test mode with no commit step, `test_end` (if any) runs after the steps. `behaviour.betweenSteps()` between steps. Fingerprint: parse `ariaSnapshot()` YAML lines, drop subtrees under `grid|listbox|list|table|row|article|document|main > heading`, keep `banner|navigation|search|toolbar|button|tab|menuitem|combobox|searchbox|link` lines outside those, strip digits, sort-unique, sha256. Session: `chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: !headedOffscreen, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled', ...(headedOffscreen ? ['--window-position=-2400,-2400'] : [])], viewport: { width: 1440, height: 900 }, locale, timezoneId })`; read `navigator.userAgent`; if it contains `HeadlessChrome`, apply `Emulation.setUserAgentOverride` with `Chrome` via a CDP session on every page (`context.on('page')`). Profile dir created with mode 0o700.

- [ ] Failing tests (fixture server + headless Chrome, `HumanBehaviour` timeScale 0): list_inbox extracts rows with formats; open_message by `$message_id` placeholder; compose_send in **test** mode fills fields, never clicks Send (fixture counts Send clicks = 0), runs discard; compose_send **live** clicks Send once; verify_recipients mismatch (fixture autocompletes a different address) → `recipients_mismatch` and Send clicks = 0; two visible Send buttons → `target_ambiguous`; missing button → `target_not_found`; redirect to login host mid-operation → `NeedsLoginError`; `expect` unmet → `state_not_reached`; capturePage returns aria + unnamed elements; fingerprint unchanged when only row contents/counts change, changed when a toolbar button is renamed.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(webmail-browser): strict route executor, page capture, layout fingerprint and Chrome session`.

### Task 4: `@teamsuzie/email-webmail` — goals, seed routes, route store, client, canary

**Files:** package (deps: `@teamsuzie/email`, `@teamsuzie/webmail-routes`, `@teamsuzie/webmail-browser`, `playwright-core`); `src/goals.ts`, `src/routes/gmail.ts`, `src/routes/outlook.ts`, `src/route-store.ts`, `src/client.ts`, `src/canary.ts`, `src/index.ts`, README; tests `src/routes.test.ts` (seed routes validate), `src/route-store.test.ts`, `src/client.test.ts` (fixture-backed using the Task 3 fixture route), `src/canary.test.ts`.

**Interfaces (produced):**
```ts
export const OPERATION_GOALS: Record<OperationName, string>;
export const OPERATION_OUTPUTS: Record<OperationName, { as: string; list: boolean; fields: string[] } | null>;
//   read_account → {as:'account', list:false, fields:['address']}
//   list_inbox, search, check_sent → {as:'messages', list:true, fields:['id','from','subject','date']} (+ optional thread_id, snippet, unread)
//   open_message → {as:'message', list:false, fields:['subject','from','date','body']} (+ optional to, cc, thread_id)
//   read_thread → {as:'messages', list:true, fields:['from','date','body']}
//   compose_send, reply → null
export const SEED_ROUTES: Record<ProviderKey, Route>;
export class FileRouteStore { constructor(dir: string); seed(route: Route): void /* writes only if absent */; current(provider: ProviderKey): Route /* throws if absent or invalid */; save(route: Route): void /* history/<version>.json + current.json */; history(provider): string[] }
export interface WebmailAccount { address: string; provider: ProviderKey }
export interface WebmailClientDeps { account: WebmailAccount; executor: RouteExecutor; routes: { current(): Route }; limiter: VolumeLimiter; behaviour: Behaviour }
export class WebmailEmailClient implements EmailClient {
  constructor(deps: WebmailClientDeps);
  status(): EmailStatus; listAccounts(): Promise<EmailAccount[]>;
  listMessages(input?: ListEmailMessagesInput): Promise<ListEmailMessagesResult>; // search ? 'search' : 'list_inbox'
  getMessage(id: string): Promise<EmailMessage>;          // limiter 'open', reading pause by body length
  getThread(id: string): Promise<EmailThreadDetail>;
  send(input: SendEmailInput): Promise<QueuedEmailResult>; // throws on html/attachments; limiter 'send'
  reply(input: ReplyEmailInput): Promise<QueuedEmailResult>; // getMessage first; expected to = input.to ?? message.from
  readAccount(): Promise<string>;
  confirmSent(subject: string, to: string): Promise<boolean>; // check_sent
  testOperation(op: OperationName, params: Params): Promise<OperationResult>;
}
export class RouteOutputError extends RouteError {}   // code 'extract_invalid' when a required output field is absent from the route's result
export interface CanaryResult { operation: OperationName; ok: boolean; error?: { name: string; code?: string; message: string } }
export function canaryParams(client: WebmailEmailClient): Promise<Record<OperationName, Params>>; // from live list_inbox/read_account
export function runCanary(client: WebmailEmailClient, only?: OperationName[]): Promise<CanaryResult[]>; // NeedsLoginError / NavigationError rethrown
```

Seed routes: Gmail and Outlook, written with accessibility locators from what TeamSuzie's drivers found (Gmail: `button "Compose"` → `role=button name=Compose`, To `combobox "To recipients"`, Subject `textbox "Subject"`, body `textbox "Message Body"`, Send `button` name_pattern `^Send`, discard `button` name_pattern `^Discard draft`, rows `css: tr.zA` with `attr:data-legacy-thread-id`; Outlook: `button` name_pattern `^New (mail|email|message)`, To `textbox "To"`, Subject `textbox "Add a subject"`/`Subject`, body `textbox` name_pattern `Message body`, rows `role=option`, Send `button "Send"`, Discard `button "Discard"`). They are unverified against live accounts; the first canary relearns any that fail. Login domains: gmail `accounts.google.com`; outlook `login.microsoftonline.com`, `login.live.com`.

- [ ] Failing tests: both seed routes pass `validateRoute`; route store seed/current/save/history and throws on missing; client against fixture route: listMessages, search, getMessage, send (live, fixture records sent message), reply computes expected to, confirmSent true/false, missing required output field → `extract_invalid`, html/attachments → throws; canary over fixture route returns ok for every op and never clicks Send.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(email-webmail): EmailClient over learned webmail routes, seed Gmail/Outlook routes, canary`.

### Task 5: `@teamsuzie/webmail-learn` — model adapter, prompt, parser, learner

**Files:** package (deps: `@teamsuzie/webmail-routes`, `@teamsuzie/webmail-browser`, `@teamsuzie/models`, `playwright-core`); `src/model.ts`, `src/prompt.ts`, `src/parse.ts`, `src/learner.ts`, `src/index.ts`, README; tests `src/parse.test.ts`, `src/prompt.test.ts`, `src/learner.test.ts` (fixture variant `gmail-like-v2.html` with renamed buttons + scripted fake model).

**Interfaces (produced):**
```ts
export interface RouteModel { id: string; complete(prompt: string): Promise<string> }
export function openAiCompatibleRouteModel(opts: { baseUrl: string; model: string; apiKey?: string; fetchImpl?: typeof fetch; maxTokens: number }): RouteModel; // chatOnce, provider 'openai-compatible', json: true
export interface RepairRequest { route: Route; operation: OperationName; goal: string; outputs: string; failure: { code: string; stepIndex: number; message: string }; capture: PageCapture; previousProblems: string[] }
export function buildRepairPrompt(req: RepairRequest): string;
export interface RepairProposal { steps: Step[]; test_end?: Step[]; states: Record<string, PageState>; notes: string }
export function parseRepair(text: string): RepairProposal;   // throws RepairParseError with a plain message
export function applyRepair(route: Route, operation: OperationName, proposal: RepairProposal): Route; // replaces the operation, upserts states; route_version untouched
export interface LearnerDeps { model: RouteModel; executor: RouteExecutor; page: Page; maxStepFixes: number; log: (msg: string) => void }
export type LearnOutcome = { ok: true; route: Route; notes: string[]; changedStates: string[] } | { ok: false; reason: string };
export class RouteLearner {
  constructor(deps: LearnerDeps);
  relearn(input: { route: Route; operation: OperationName; goal: string; outputs: string; params: Record<OperationName, Params>; failure: RouteError }): Promise<LearnOutcome>; // one attempt
}
```

Attempt: loop up to `maxStepFixes`: reset page to `home_url`; run the candidate operation in test mode; pass → run test mode for every other operation whose steps reference a changed state; all pass → return ok with `route_version = nextRouteVersion`, `learned_by = learner:<model.id>`, `learned_at`, fingerprint = `computeFingerprint` after `goto home`. Route error → capture → prompt → parse → apply → `validateRoute`; parse/validation problems are pushed to `previousProblems` and count as a fix. `NeedsLoginError` / `NavigationError` propagate.

Prompt content (plain English): what the system is; the operation's goal and required output fields; the action set with one example each; target rules (accessibility role + name first, CSS only for unnamed elements, exactly one visible match, `each: true` for lists, no generated numeric ids); placeholder list; the commit/test_end rule; the current operation and states as JSON; the failing step and error; the URL, accessibility snapshot (truncated to 60k chars) and unnamed elements (truncated 15k); earlier problems; exact JSON reply shape `{ "steps": [...], "test_end": [...], "states": {...}, "notes": "..." }`.

- [ ] Failing tests: parseRepair accepts plain JSON and JSON in a ```json fence, rejects prose / missing steps; applyRepair replaces only the target operation; prompt contains goal, failing step, snapshot and no undefined; learner with fake model fixes the v2 fixture (Compose renamed "New message") in one fix; learner gives up after `maxStepFixes` with fake model returning junk, and each junk reply's problem appears in the next prompt; learner checks dependent operations when a state changes.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(webmail-learn): relearn broken webmail routes with a local model`.

### Task 6: email-agent — config, db, stores (approvals, health, alerts, new mail)

**Files:** `apps/agents/email-agent/` package (deps: all four packages, `@teamsuzie/jobs`, `@teamsuzie/approvals`, `@teamsuzie/email`, `@teamsuzie/db-sqlite`, `@modelcontextprotocol/sdk`, `zod@^3.25`, `express@^5`, `playwright-core`; dev: `tsx`, `@types/express`); `src/config.ts`, `src/db.ts`, `src/approval-store.ts`, `src/health.ts`, `src/alerts.ts`, `src/new-mail.ts`, `email-agent.config.example.json`; tests for each.

**Interfaces (produced):**
```ts
export interface AgentConfig { data_dir: string; listen: { host: '127.0.0.1'; port: number }; admin_token: string; agents: { id: string; token: string }[]; accounts: { address: string; provider: ProviderKey; headed_offscreen: boolean }[]; learner: { base_url: string; model: string; api_key_env: string | null; max_step_fixes: number; attempts: number; max_tokens: number }; canary_interval_hours: number; check_inbox_minutes: [number, number]; default_job_timeout_minutes: number; login_timeout_minutes: number; locale: string; timezone: string; volume: { opens_per_minute: number; opens_per_hour: number; min_seconds_between_sends: number; quiet_hours: { start: string; end: string } | null }; send_policy: { rules: SendRule[] } }
export type SendRule = { allow: ('send'|'reply')[]; agents: string[]; all_recipients_in_domains?: string[]; recipients_already_in_thread?: boolean } | { max_per_hour: number; agents: string[] };
export function loadConfig(path: string): AgentConfig;   // throws naming every invalid/missing field
export function openAgentDb(path: string): Database;     // migrations for approvals, op_health, alerts, new_mail; jobs tables via SqliteJobStorage.open({ db })
export class SqliteApprovalStore implements ApprovalStore { constructor(db) ; findByJobId(jobId): Promise<ApprovalItem | null> }
export type OpState = 'healthy'|'suspect'|'relearning'|'broken';
export class HealthStore { get(account, op): { state: OpState; since: string; last_error: string | null; relearn_attempts: number; send_unconfirmed: boolean }; set(account, op, patch): void; all(account?): ... }
export interface Alert { id: string; account: string; kind: 'route_broken'|'needs_login'|'account_mismatch'|'route_relearned'|'send_unconfirmed'; message: string; created_at: string }
export interface Notifier { notify(alert: Alert): Promise<void> }
export class MacNotifier implements Notifier   // osascript display notification; errors propagate
export class AlertStore { constructor(db, notifiers: Notifier[]); raise(input): Promise<Alert>; list(sinceId?): Alert[] }
export interface MailSummary { id: string; thread_id: string | null; from: string; subject: string; date: string; snippet: string | null }
export class NewMailStore { record(account, summaries): MailSummary[] /* new ones only */; list(opts: { after: number; account?: string; limit: number }): { items: (MailSummary & { seq: number; account: string })[]; cursor: number } }
```

- [ ] Failing tests: config rejects missing fields / non-loopback host / duplicate agent tokens / unknown provider and accepts the example; approval store CRUD + list filters + findByJobId; health defaults to healthy and persists; alerts raise calls notifiers and lists; new-mail dedupes and pages by cursor.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(email-agent): config, SQLite stores for approvals, health, alerts and new mail`.

### Task 7: email-agent — send policy and job submission

**Files:** `src/policy.ts`, `src/jobs.ts`; tests `src/policy.test.ts`, `src/jobs.test.ts`.

**Interfaces (produced):**
```ts
export interface PolicyInput { kind: 'send'|'reply'; agentId: string; recipients: string[]; threadParticipants: string[] | null; autoSentLastHour: number }
export function evaluateSendPolicy(rules: SendRule[], input: PolicyInput): { allowed: true; rule: number } | { allowed: false; reason: string };
export const JOB_KINDS = ['list_inbox','read_message','read_thread','search','send','reply','check_inbox'] as const;
export const jobParamSchemas: Record<AgentJobKind, z.ZodType>;
export interface SubmitDeps { queue: JobQueue; approvals: ApprovalQueue; approvalStore: SqliteApprovalStore; config: AgentConfig; autoSentLastHour(agentId: string): number; threadParticipants(account: string, messageId: string): string[] | null; now(): Date }
export function accountQueue(address: string): string; // `account:${address}`
export function submitJob(deps: SubmitDeps, agentId: string, input: { account: string; kind: AgentJobKind; params: unknown; timeout_seconds?: number }): Promise<{ job_id: string; status: 'queued' | 'awaiting_approval' }>;
export function jobView(deps, jobId: string): Promise<JobView>; // status: awaiting_approval|queued|running|done|failed|cancelled, result, error {code,message}
```
Reply recipients for policy: `params.to` when given, else the original sender recorded in NewMailStore (`threadParticipants` from summaries the service has seen); unknown → approval. Approval dispatcher `email.send_job` enqueues the job with the pre-generated id. Agents cannot submit `check_inbox`.

- [ ] Failing tests: rule allows matching agent+domains; any recipient outside domains → not allowed; agent not in rule → not allowed; `*` agents; recipients_already_in_thread; `max_per_hour` cap → not allowed; no rules → not allowed; submitJob validates params (bad kind/account → `invalid_request`), queued vs awaiting_approval, approve → job enqueued with same id, reject → jobView failed `approval_rejected`.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(email-agent): policy-based send approval and job submission`.

### Task 8: email-agent — account handler (jobs, health, relearn, canary, login)

**Files:** `src/handler.ts`; tests `src/handler.test.ts` with a fake `HandlerRuntime`.

**Interfaces (produced):**
```ts
export interface HandlerRuntime {           // the browser-facing side, faked in tests
  open(): Promise<void>; close(): Promise<void>;
  client(): WebmailEmailClient-like;       // listMessages/getMessage/getThread/send/reply/readAccount/confirmSent/testOperation
  canary(only?: OperationName[]): Promise<CanaryResult[]>;
  relearn(op: OperationName, failure: RouteError): Promise<LearnOutcome>;  // also saves the route on ok
  fingerprintChanged(): Promise<boolean>;
  login(): Promise<'completed' | 'timed_out'>;
}
export class AccountHandler {
  constructor(deps: { account; queue: JobQueue; runtime: HandlerRuntime; health: HealthStore; alerts: AlertStore; newMail: NewMailStore; config: AgentConfig; now(): Date; random(): number; log(msg): void });
  start(): void; stop(): Promise<void>;
  tick(): Promise<'idle' | 'ran'>;               // one claim+run, for tests
  requestLogin(): Promise<void>; requestRelearn(op): Promise<void>; requestCanary(): Promise<CanaryResult[]>;
  state(): { account: string; status: 'starting'|'ready'|'needs_login'|'account_mismatch'|'logging_in'; operations: Record<OperationName, OpHealth> };
}
```
Rules: one job at a time; jobs whose `deadline` passed fail `job_timeout`; quiet hours: non-urgent jobs re-queued for quiet-hours end; operation `broken` → fail `route_broken` immediately; route error → op `suspect` → `runtime.canary([op])` → passes: retry job once; fails: `relearning`, up to `learner.attempts` × `runtime.relearn` → ok: `healthy`, alert `route_relearned`, mark `send_unconfirmed` when op is `compose_send`/`reply`, retry job once; all fail: `broken`, alert `route_broken`, job `route_broken`. After a live send/reply with `send_unconfirmed`: `confirmSent` → true clears flag; false → both send ops `broken`, alert `send_unconfirmed`. `NeedsLoginError` → status `logging_in`, alert `needs_login`, `runtime.login()` → completed: retry job; timed_out: status `needs_login`, stop claiming (jobs time out by deadline via a sweep that fails overdue queued jobs `needs_login`), resume on `requestLogin`. `read_account` mismatch at start/after login → `account_mismatch`, alert, all jobs fail `account_mismatch`. `NavigationError` → re-queue with backoff until deadline. check_inbox scheduled every random [min,max] minutes: list_inbox, record new summaries, then fingerprint check → changed: canary all ops and relearn failures. Canary every `canary_interval_hours` ± 20%: failures go through the same suspect→relearning path. Broken ops retry relearn daily. Job failure error codes are put in `JobError.code`.

- [ ] Failing tests (fake runtime + in-memory job storage + `:memory:` db): success path stores result; deadline → `job_timeout`; broken op fails fast; route error → canary pass → retry succeeds; route error → relearn ok → alert + retry; three failed relearns → broken + alert + `route_broken`; needs_login → login completed → retry; login timed_out → status needs_login, overdue jobs fail `needs_login`; account mismatch; send_unconfirmed path both outcomes; check_inbox records new mail and triggers canary on fingerprint change; quiet hours defer non-urgent jobs.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Commit `feat(email-agent): per-account handler with route health, relearning, canary and login`.

### Task 9: email-agent — real runtime, MCP server, admin API, service, CLI

**Files:** `src/runtime.ts` (real `HandlerRuntime` from session + executor + client + learner + FileRouteStore), `src/mcp.ts`, `src/admin.ts`, `src/service.ts`, `src/cli.ts`, `bin` entry in package.json, README; tests `src/mcp.test.ts` (in-memory transport client against `createMcpServer` with fake deps), `src/admin.test.ts` (supertest-free: start express on port 0 and `fetch`).

**Interfaces (produced):**
```ts
export function createMcpServer(deps: { submit, view, list, cancel, accounts, newMail, alerts }, agentId: string): McpServer;
// tools: submit_job, get_job, wait_job{job_id, timeout_seconds≤120}, list_jobs, cancel_job, list_accounts, account_status, list_alerts, list_new_mail
export function adminRouter(deps): express.Router;  // bearer admin_token; GET /status, POST /login/:account, POST /relearn/:account/:op, POST /canary/:account, GET /approvals, POST /approvals/:id/approve, POST /approvals/:id/reject, GET /alerts
export function startService(config: AgentConfig): Promise<{ close(): Promise<void>; url: string }>;
// CLI: email-agent serve|status|login <account>|relearn <account> <op>|canary <account>|approvals|approve <id>|reject <id> [reason]  (--config <path> or EMAIL_AGENT_CONFIG)
```
MCP over streamable HTTP at `/mcp`, stateless (new server + transport per request), bearer token → agent id, 401 otherwise. Agents see only their own jobs in `list_jobs`/`get_job`.

- [ ] Failing tests: MCP submit/get/wait/list/cancel with fake deps and agent scoping; unknown token → 401; admin requires admin token; approve endpoint dispatches.
- [ ] Run → FAIL. Implement. Run → PASS + typecheck.
- [ ] Manual smoke (no live account): `email-agent serve` with example config pointing at a fixture-only account is out of scope; instead run `pnpm --filter @teamsuzie/email-agent build` and `node dist/cli.js --help`.
- [ ] Commit `feat(email-agent): MCP server, admin API, CLI and Chrome-backed runtime`.

### Task 10: Docs and whole-repo checks

- [ ] READMEs for all five units; add the packages to the root README package list if one exists; add `dev:email-agent` script to root package.json.
- [ ] `pnpm -r --filter "./packages/webmail-*" --filter ./packages/email-webmail --filter ./apps/agents/email-agent typecheck test build` all pass.
- [ ] Commit `docs: webmail email agent packages and service`.
