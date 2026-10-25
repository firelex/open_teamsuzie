# email-agent

A local service that lets agents read, search and send your own Gmail and Outlook mail by driving the webmail page in
Google Chrome, the way you would. Agents never touch the browser: they submit jobs to a queue over MCP, and one
handler per mailbox works through that mailbox's jobs one at a time, at a human pace.

Design: `docs/superpowers/specs/2026-10-25-webmail-email-agent-design.md`.

## How it works

- **Routes.** Where to click is data (`@teamsuzie/webmail-routes`): for each action — list the inbox, open a message,
  search, send, reply, … — a list of steps with accessibility targets. A fixed executor (`@teamsuzie/webmail-browser`)
  runs them strictly: a target that matches nothing or more than one thing is a failure, never a guess.
- **Keyboard shortcuts first.** Relearning starts by reading the webmail's own shortcut list (the "?" panel) and
  prefers its shortcuts for new message, reply, send and search, which do not depend on window size or menus. Only
  harmless keys are allowed, and a sending key only as the step marked as the commit, so tests never send by
  keyboard. Gmail's shortcuts are off by default (Settings > General > Keyboard shortcuts on); without them the
  learner clicks. The browser window is 1920×1080 so toolbars show their buttons.
- **Leftover test drafts.** Every draft the service writes while testing carries the text
  `Route check by email-agent: safe to discard.` Shortly after start-up and then daily, it searches Drafts for that
  text and discards up to 20 such drafts. Before discarding, it checks the opened draft really contains the text;
  a draft without it is closed untouched. Your own drafts are never discarded.
- **Clean start.** Every action starts from the inbox: any draft or reply left open is discarded first, then the
  inbox is loaded and must show. A test-mode run also checks that its discard really closed the draft
  (`cleanup_failed` otherwise), so broken discard steps are caught on their first test, not by piling up drafts.
- **Knowing when to relearn.** A route is checked again when a job fails on it, when the inbox layout's fingerprint
  changes (checked on every inbox poll), and by a canary every `canary_interval_hours` (`null` for none; there is no
  canary at start-up). The canary and every relearning test run
  in test mode: drafts are filled and then discarded, Send is never pressed.
- **Relearning speed.** Relearning's own test runs type about three times faster than the human pace of real
  jobs and give up on a missing element after 3 s (6 s for a page state); one attempt typically takes under a
  minute. `learner.attempts` sets how many attempts an action gets before it is marked broken.
- **Relearning.** A failing action is rebuilt by your model (`@teamsuzie/webmail-learn`) on the live page: it
  tests targets, states and extracts with tools, runs candidates in test mode, and submits a repair, which must
  pass the no-send test (and not break other actions) before it is used. After 3 failed attempts the action is **broken**: its jobs fail at
  once with `route_broken`, you get an alert, and it is retried daily (or `email-agent relearn`).
- **Dates.** Dates are read the way your webmail shows them, in `locale` (day/month order, month and day names,
  "Yesterday") and `timezone`. A value the service cannot read is not a route problem: the job fails with
  `unreadable_value` and you are alerted, without relearning.
- **Learner transcripts.** Every prompt and model reply is kept in `data_dir/learner/<date>.jsonl`, with the reason
  a reply was rejected, so the relearning model can be judged.
- **Sends.** A send goes out at once only when a rule in `send_policy` allows it; otherwise it waits for your
  approval (notification, then `email-agent approve <id>` or the console). The recipients shown on the page must equal
  the requested ones before Send is pressed. After a send action is relearned, the next send is confirmed in Sent
  (by its subject, sent within the last 15 minutes when the list shows dates, and its recipients when the list shows
  addresses rather than names); if it is not there, sending stops and you are alerted.
- **Sign-in.** Once per account, and whenever the provider signs you out: a visible Chrome window opens on the
  account's own profile, you sign in (password, 2FA), it closes and the account carries on headless. The service
  never sees your password.
- **Looking human.** Your installed Chrome, no automation flags, real mouse paths and key-by-key typing, reading
  pauses, per-account limits on how many messages are opened per minute/hour and how often it sends, and quiet hours
  (only `urgent` jobs run). Automating webmail may breach Google's and Microsoft's terms; the realistic risk is a
  sign-in challenge or a temporary lock.

## Setup

1. Google Chrome installed; Node 22+; `pnpm install` and `pnpm -r build` at the repo root.
2. Copy `email-agent.config.example.json` somewhere private and fill it in:
   - `admin_token` and each agent's `token`: long random strings (`openssl rand -hex 32`).
   - `accounts`: your addresses and `gmail` / `outlook`.
   - `learner`: your model's OpenAI-compatible endpoint (`base_url`, e.g. `http://spark-fa14:8888/v1`) and its model id
     as `/v1/models` lists it; the model must support tool calls. `api_key_env` names an environment variable holding
     its key, or `null`. Each relearn attempt may make up to `max_tool_calls` tool calls and `max_submissions`
     submissions; `attempts` is how many attempts before an action is marked broken.
   - `send_policy.rules`: which agents may send to whom without asking you. An allow rule must restrict recipients
     (`all_recipients_in_domains` or `recipients_already_in_thread`); `max_per_hour` caps unapproved sends.
3. `email-agent --config <path> serve`. For each account: `email-agent --config <path> login <address>` and sign in
   in the window that opens. The first canary runs at start-up and relearns any action whose starting route no
   longer matches your mailbox.

Every config value is required; the service will not start with a missing or invalid one and says which.

## Using it

**From an agent (MCP).** The service speaks MCP over HTTP at `http://127.0.0.1:<port>/mcp`; each agent
authenticates with its own token. In Claude Code:

```bash
claude mcp add --transport http email-agent http://127.0.0.1:4317/mcp --header "Authorization: Bearer <agent token>"
```

Tools: `submit_job`, `wait_job`, `get_job`, `list_jobs`, `cancel_job`, `list_accounts`, `account_status`,
`list_alerts`, `list_new_mail`. Job kinds: `list_inbox`, `read_message`, `read_thread`, `search`, `send`, `reply`.

**By hand (console).** Open `http://127.0.0.1:<port>/console` and enter the admin token: list and search the inbox,
open messages, write and reply, approve or reject held sends, sign in, run the canary, see each action's health and
the alerts. The console's mail actions go through the same MCP tools as the `console` agent, so every send it makes
waits for approval.

**CLI.** `status`, `login <account>`, `canary <account>`, `relearn <account> <action>`, `approvals`,
`approve <id>`, `reject <id> [reason]`, `alerts`, and `capture <account>`, which saves the account's page as it
is now (accessibility tree, outline and screenshot, under `data_dir/captures/`) for diagnosing a failing action.

## Job errors

| Code | Meaning |
|---|---|
| `route_broken` | That mail action is broken and could not be relearned; you have been alerted |
| `unreadable_value` | The page showed a value (such as a date) the service cannot read; relearning cannot fix this, you are alerted |
| `needs_login` | The account must be signed in again; the job's deadline passed while waiting |
| `account_mismatch` | The browser is signed in to a different account |
| `approval_rejected` | You rejected the send |
| `recipients_differ` | The webmail would have sent to other addresses than requested (a reply's reply-to address, or autocomplete picking another contact). Nothing was sent; the message names the addresses, and the agent can resubmit with `to` set to them |
| `send_unconfirmed` | Send was pressed after the send action changed, but the message is not in Sent |
| `job_timeout` | The job's deadline passed |
| `invalid_request` | Unknown account or kind, bad parameters, or something the page cannot do (HTML, attachments) |
| `internal_error` | An unexpected error; the message says what |

## Files

`data_dir` holds `email-agent.db` (queue, approvals, action health, alerts, new mail), `routes/<provider>/current.json`
plus every earlier version in `routes/<provider>/history/`, and `profiles/<address>/` (each account's Chrome
profile, owner-only).
