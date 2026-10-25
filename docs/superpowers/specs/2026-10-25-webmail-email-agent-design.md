# Webmail Email Agent — Design

Date: 2026-10-25
Status: Draft for review

## 1. Purpose

Give the agents in an agent system access to the user's own Gmail and Outlook mailboxes — read, search and send — by driving the providers' web interfaces in a real browser, not through provider APIs or OAuth apps.

The approach is lifted from the TeamSuzie Flutter app (`teamsuzie_monorepo/app`): where to click is data (a "route"), how to click is fixed code (an "executor"), and when a route stops working an LLM relearns it from the live page. This design rebuilds that idea as headless TypeScript/Node packages and a local service in `open_teamsuzie`, with no UI, no fallback selectors, and automatic detection of when relearning is needed.

### Requirements (from the user)

- TypeScript/Node, in `open_teamsuzie` (the reusable component library).
- Agents interact **only with a queue**. They submit read, send and search requests and read results. They never drive a browser.
- **One account handler per account.** Only that handler touches that account's browser.
- Headless operation after login. Login (username, password, 2FA) happens in a visible browser window on the user's machine; the service then continues headless with the same browser profile.
- The service runs on the **user's own machine** (residential/office IP, installed Chrome).
- **No fallback routes.** A route works or fails loudly.
- The system must know **when to re-run** the learning step, and must tell the user when a route is broken and cannot be fixed.
- Relearned routes go live **automatically** once they pass a no-send live test.
- Sends are **policy-based**: automatic within user-defined rules, everything else waits for human approval.
- Browsing must look like a person using webmail, not a machine.
- The relearning model is a **local model on the user's own servers**; captures are sent to it unredacted.

### Non-goals (v1)

- Running on a server with remote login (the login step sits behind an interface so this can be added later).
- Provider APIs (Gmail API, Microsoft Graph). `@teamsuzie/email-gmail` already covers the Gmail API.
- Attachments on outgoing mail, forwarding, labels/folders management, calendar.
- A user interface beyond the CLI and OS notifications.

## 2. Components

Four reusable packages in `packages/` and one service in `apps/agents/`.

| Unit | Responsibility | Depends on |
|---|---|---|
| `@teamsuzie/webmail-routes` | Route schema (operations → steps → actions, targets, page states, extraction fields), the validator, TypeScript types. Pure data, no browser. | — |
| `@teamsuzie/webmail-browser` | Per-account Playwright session (installed Chrome, persistent profile), visible-window login handoff, the **executor** (runs one route operation strictly), the **behaviour layer** (human-like input, pacing, volume limits), page capture. | `webmail-routes`, `playwright` |
| `@teamsuzie/webmail-learn` | Relearning: capture → model proposes replacement steps → validate → no-send live test → accept or reject. | `webmail-routes`, `webmail-browser`, `@teamsuzie/models` |
| `@teamsuzie/email-webmail` | `WebmailEmailClient implements EmailClient` for one account; the operation goal descriptions; the initial (seed) Gmail and Outlook routes. | all of the above, `@teamsuzie/email` |
| `apps/agents/email-agent` | The service: job queue, account handlers, send policy + approvals, route health monitor, local mail store, MCP server, CLI. | all of the above, `@teamsuzie/jobs`, `@teamsuzie/approvals`, `@teamsuzie/email-sync` |

Each package has its own README in the style of the existing `email-*` packages.

### Relationship to existing packages

- `@teamsuzie/email` — `WebmailEmailClient` implements its `EmailClient` interface (`listMessages({search})`, `getMessage`, `getThread`, `listThreads`, `send`, `reply`, `changesSince`). Members the browser cannot honour are left unimplemented, as `email-simulator` does.
- `@teamsuzie/email-sync` — keeps the local mail store current from `check_inbox` results; its HTML sanitising and quoted-history detection are reused unchanged.
- `@teamsuzie/jobs` — the queue (SQLite storage). Each account handler is a worker that takes only its own account's jobs.
- `@teamsuzie/approvals` — holds sends that the policy does not allow automatically.
- `@teamsuzie/models` — the gateway to the local relearning model.

## 3. Job flow

```
agent ──MCP──▶ submit_job {account, kind, params} ──▶ queue (SQLite) ──▶ jobId
                   │
                   │ send / reply: send policy ──allowed──▶ queued
                   │                         └─otherwise─▶ approvals: pending ──approved──▶ queued
                   ▼
      account handler (one per account, one job at a time, owns its browser)
                   ▼
      WebmailEmailClient → executor → behaviour layer → Chrome
                   ▼
      result stored on the job ──MCP──▶ agent: get_job / wait_job
```

### Job kinds

| Kind | Params | Result |
|---|---|---|
| `list_inbox` | `limit` | message summaries (id, thread id, from, subject, date, snippet, unread) |
| `read_message` | `message_id` | full `EmailMessage` |
| `read_thread` | `thread_id` | `EmailThreadDetail` |
| `search` | `query` (provider search syntax), `limit` | message summaries |
| `send` | `SendEmailInput` (no attachments in v1) | `QueuedEmailResult` with thread id when shown |
| `reply` | `ReplyEmailInput` | `QueuedEmailResult` |
| `check_inbox` | — (internal, scheduled by the handler) | new messages written to the local mail store |

Message and thread ids are the provider's own ids as exposed in the web page (Gmail's thread/message ids, Outlook's item ids), extracted by the route.

### MCP tools (agent-facing)

`submit_job`, `get_job`, `wait_job` (blocks up to N seconds), `list_jobs`, `cancel_job` (only before a handler starts it), `list_accounts`, `account_status`, `list_alerts`, `list_new_mail` (reads the local mail store; does not touch the browser).

### New mail feed

Each handler schedules its own low-priority `check_inbox` job every 5–15 minutes (random spacing). New messages go into the local mail store via `@teamsuzie/email-sync`. Agents read them with `list_new_mail`, which returns messages after a cursor the agent holds.

## 4. Route format

One route per provider, JSON, validated before use. Example (abridged):

```json
{
  "schema_version": 1,
  "provider": "gmail",
  "route_version": "2026-10-25.1",
  "learned_by": "seed",
  "domains": ["mail.google.com"],
  "home_url": "https://mail.google.com/mail/u/0/#inbox",
  "fingerprint": "sha256:…",
  "states": {
    "inbox_list":   { "url_matches": "#inbox", "visible": [{ "role": "grid" }] },
    "compose_open": { "visible": [{ "role": "dialog", "has": { "role": "combobox", "name": "To recipients" } }] }
  },
  "operations": {
    "compose_send": {
      "steps": [
        { "click": { "role": "button", "name": "Compose" }, "expect": "compose_open" },
        { "type":  { "role": "combobox", "name": "To recipients", "within": "compose_open" }, "value": "$draft.to", "then_press": "Tab" },
        { "fill":  { "role": "textbox", "name": "Subject", "within": "compose_open" }, "value": "$draft.subject" },
        { "fill":  { "role": "textbox", "name": "Message Body", "within": "compose_open" }, "value": "$draft.body" },
        { "verify_recipients": { "within": "compose_open" } },
        { "click": { "role": "button", "name": "Send", "within": "compose_open" }, "commits": true, "expect": "inbox_list" }
      ],
      "test_end": [{ "click": { "role": "button", "name": "Discard draft", "within": "compose_open" } }]
    }
  }
}
```

### Operations

Each provider route defines: `read_account` (signed-in address), `list_inbox`, `open_message`, `read_thread`, `search`, `compose_send`, `reply`, `check_sent` (find a just-sent message in Sent).

### Actions

Fixed set: `goto` (only `home_url` or a URL matching `domains`), `click`, `fill`, `type` (real key presses), `press`, `scroll`, `wait_for` (a named state), `extract`, `verify_recipients`. Nothing else is executable; the validator rejects unknown keys.

### Targets

- Preferred: Playwright accessibility locators — `role`, `name` (exact or `name_pattern` regex), `within` (a named state's container), `has`.
- `css` only where the element has no accessible name. The validator rejects selectors that depend on generated numeric ids (carried over from TeamSuzie).
- A target must resolve to **exactly one** visible element. Lists declare `"each": true` explicitly; otherwise zero matches is `target_not_found` and several is `target_ambiguous`.

### Values

Step values may only reference job parameters through a fixed set of placeholders (`$draft.to`, `$draft.cc`, `$draft.subject`, `$draft.body`, `$query`, `$message_id`, `$thread_id`). Unknown placeholders fail validation.

### States and postconditions

`states` are named page conditions (URL pattern and/or required visible targets). A step's `expect` names the state that must hold after it, within a timeout. Not reaching it is `state_not_reached`.

### Extraction

`extract` maps result fields to a target plus `attr` (text, an attribute, or the accessible name), optional `pattern` (regex with one capture group), `required`, and a `format` check (`email`, `date`, `nonempty`, `id`). A required field that is missing or fails its format check is `extract_invalid`. A run that returns junk is a failed run.

### Commit steps and test mode

`commits: true` marks the irreversible step (Send). In **test mode** the executor runs every step up to the commit step, skips it, and runs `test_end`. Operations with a commit step must define `test_end`; the validator enforces this.

`verify_recipients` reads the recipients the page actually shows and requires them to equal the draft's To/Cc/Bcc (case-insensitive, order-insensitive). A mismatch stops the operation before Send.

### Fingerprint

At learn time the route stores a hash of the page's main structure: landmark regions and the names of toolbar buttons on `inbox_list`. Message content is excluded so the hash changes only when the layout changes.

### Versioning

`route_version` is `YYYY-MM-DD.N`. Every accepted route is saved to a local history (for audit and diffs). Only the current version is ever used; old versions are never used automatically.

### Seed routes

`@teamsuzie/email-webmail` ships an initial Gmail and Outlook route. It is the starting point for a new install, not a fallback: once a route is relearned, the relearned version replaces it. Selectors are never merged.

## 5. Detecting breakage and when to relearn

### Triggers

1. **Job failure** with a route error: `target_not_found`, `target_ambiguous`, `state_not_reached`, `extract_invalid`.
2. **Fingerprint change**: every `check_inbox` recomputes the fingerprint on `inbox_list`. A change triggers an immediate canary, even if nothing has failed.
3. **Scheduled canary**: a test-mode run of every operation about every 6 hours (random spacing), ending in discarding the draft.

### Failures that are not route problems

These never trigger relearning:

| Situation | Detection | Outcome |
|---|---|---|
| Provider sign-in page | URL on the provider's sign-in domains | account → `needs_login`, user notified |
| Different signed-in account | `read_account` ≠ configured address | account → `account_mismatch`, all jobs for it fail, user notified |
| Network error / navigation timeout | Playwright error class | job retried later with backoff, up to its deadline |

### Per-operation state machine

```
healthy ──route error / fingerprint change──▶ suspect ──canary fails──▶ relearning
suspect ──canary passes──▶ healthy
relearning ──candidate passes──▶ healthy (new route version)
relearning ──3 attempts fail──▶ broken
broken ──daily retry or manual relearn succeeds──▶ healthy
```

- While an operation is `suspect` or `relearning`, its jobs wait.
- When it is `broken`, new jobs for that operation fail immediately with `route_broken`. Other operations on the same account keep working.
- **Alerts** when an operation becomes `broken`, an account needs login, or an account mismatch is found: macOS notification, `list_alerts` / `account_status` over MCP, and a `Notifier` interface for other channels.
- `broken` operations retry relearning once a day. `email-agent relearn <account> <operation>` forces it.

### Send safety after automatic relearning

After a send route changes, the first real send is confirmed with `check_sent` (the message must appear in Sent with the right subject and recipients). If it does not, `compose_send` and `reply` go straight to `broken` and the user is alerted.

## 6. Relearning (`@teamsuzie/webmail-learn`)

### Operation goals

Each operation has a fixed plain-English goal written in code (in `email-webmail`), independent of any route. Example: "compose_send: open a new message, put the given addresses in the To field, fill in the subject and body, confirm that the recipients shown on the page match the given addresses, then press Send." The model is told the goal, not only the old steps.

### One attempt

1. Replay the operation in test mode up to the failing step.
2. Capture: URL, Playwright accessibility snapshot (`ariaSnapshot`), a reduced DOM for elements without accessible names, the failing step and error, the current route for the operation, and a screenshot if `learner.sendScreenshots` is on (only for models that accept images).
3. Ask the model, through `@teamsuzie/models`, for replacement steps and states for the operation as JSON matching the route schema. The prompt is plain English, self-contained, and states the action set, the target rules (accessibility locators first, exactly one match, no generated ids), and the goal.
4. Validate and apply to a candidate route. Continue the test-mode run from the fixed step. If a later step fails, capture again and repeat, up to 5 step fixes per attempt.
5. Accept when the whole operation passes in test mode **and** a test-mode run of every other operation that uses a changed state passes. Recompute the fingerprint, write a new route version, record it in history, notify the user of the change.

An invalid model reply (not JSON, fails validation) counts as a failed step fix, not a crash. Three failed attempts → `broken`.

Captures are sent unredacted: the configured model runs on the user's own servers.

## 7. Login (`@teamsuzie/webmail-browser`)

- Started by `email-agent login <account>`, or automatically when a job hits `needs_login` (with a notification: "Outlook (you@firm.com) needs you to sign in").
- The handler closes its headless context and opens **visible Chrome with the same profile** at the provider's sign-in page. The user enters password and 2FA. The service never sees or stores credentials; the session lives in the Chrome profile.
- Login completes when the route's `inbox_list` state holds **and** `read_account` returns the configured address. The window closes and the profile reopens headless.
- Time limit: 10 minutes, after which the account stays `needs_login`.
- Jobs for the account wait during login, each up to its own deadline.
- Profiles: `~/Library/Application Support/teamsuzie-email-agent/profiles/<account>/`, mode 700.
- Login sits behind a `LoginHandoff` interface so a remote-login implementation can be added later.

## 8. Behaviour layer

### Launch

- Installed Google Chrome (`channel: 'chrome'`), persistent context per account, `--headless=new`.
- No `--enable-automation`; `navigator.webdriver` not set; user agent without "HeadlessChrome"; normal viewport (e.g. 1440×900); the machine's real timezone and locale.
- One long-lived session per account; log in only when the provider requires it.
- Per-account option `headed_offscreen: true` runs a headed window off-screen, for an account that keeps getting challenged.

### Input

- Mouse moves along a curved path to a random point inside the target before clicking.
- Typing is key by key with varying delays and occasional pauses.
- No JS `.click()`, no setting `value` directly.

### Pacing

- Varied delays between steps.
- A reading pause after opening a message, scaled to its length, with occasional scrolling.
- One tab per account; navigate like a person (open a message, go back). Use `goto` only for `home_url` and search where the route says so.

### Volume limits (per account, configurable)

- Messages opened per minute and per hour.
- Minimum spacing between sends.
- Quieter overnight: only jobs marked urgent run between configured hours.
- Limits make jobs wait; they never fail them.

### Known limits

No setup is guaranteed undetectable; the main factors are a normal IP, few logins and human-scale volume. Automating webmail through the UI may breach Google's and Microsoft's terms of service; the realistic consequence is an account challenge or temporary lock.

## 9. Send policy and agent identity

### Agent identity

The MCP server listens on `127.0.0.1` only. Each agent has its own bearer token in the service config, mapping to an agent id. Every job records the submitting agent.

### Policy

```json
{ "send_policy": { "rules": [
  { "allow": ["send", "reply"], "agents": ["ops-agent"], "all_recipients_in_domains": ["firm.com"] },
  { "allow": ["reply"], "agents": ["*"], "recipients_already_in_thread": true },
  { "max_per_hour": 20, "agents": ["*"] }
]}}
```

- A send or reply goes out automatically only if a rule allows that kind for that agent **and** every To, Cc and Bcc recipient meets the rule's conditions.
- `max_per_hour` rules cap automatic sends; sends over the cap go to approval.
- No matching rule → approval. Nothing defaults to allowed.
- Pending sends are `@teamsuzie/approvals` items; the job shows `awaiting_approval`. Approval queues the job for the handler; rejection ends it with `approval_rejected`.
- Invalid policy config stops the service at startup with a message naming the bad rule.

## 10. Errors and records

Jobs end `done` or `failed`. Failure codes:

| Code | Meaning |
|---|---|
| `route_broken` | The operation's route is broken and could not be relearned |
| `needs_login` | The account must be signed in again (job deadline passed while waiting) |
| `account_mismatch` | The browser is signed in as a different account |
| `approval_rejected` | The user rejected the send |
| `job_timeout` | The job's deadline passed |
| `invalid_request` | The request was invalid (unknown account or kind, bad params) |

- Volume limits never fail a job.
- Every job records the route version, the steps run and their timings.
- Failures save a screenshot and the accessibility snapshot under the service data directory.
- No silent catches: unexpected errors fail the job with the original error message and are logged.

## 11. Configuration

One config file for the service (`email-agent.config.json`, path via flag or env var). It names accounts (address, provider), agent tokens, send policy, volume limits, canary interval, learner model id and `sendScreenshots`, and data directory. Missing required values stop the service at startup with a clear error. There are no built-in defaults for accounts, tokens or the model.

## 12. Testing

| Area | How |
|---|---|
| `webmail-routes` | Validator unit tests over good and bad routes (unknown actions, bad placeholders, generated ids, missing `test_end`). |
| `webmail-browser` | Playwright against local fixture pages: small static copies of the Gmail and Outlook layouts served by the test. Covers exactly-one-match, states, extraction checks, test mode skipping the commit step, `verify_recipients` mismatch. |
| `webmail-learn` | Same fixtures plus "changed layout" variants. A scripted fake model checks that failures are detected, a fingerprint change triggers a canary, relearning fixes the route, and three failures mark it broken. |
| `email-webmail` | `WebmailEmailClient` against fixtures; seed routes validate. |
| `email-agent` | Queue, per-account handler serialisation, send policy, approvals flow, health state machine and MCP tools with in-memory storage and a fake handler. |
| Live | `email-agent canary <account>` runs every operation in test mode against the real account, run by hand. Automated tests never send real email. |

## 13. Open questions

None blocking. To revisit after v1: attachments on outgoing mail, forwarding, remote login, labels/folders.
