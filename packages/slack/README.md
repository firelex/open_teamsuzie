# @teamsuzie/slack

A small Slack Web API client for an app a company installs in its Slack workspace, working with the app's bot token
(`xoxb-…`), not a person's sign-in. `SlackClient` reads and posts:

- `authTest()`: the workspace and the app's bot user (`botUserId`: messages mention the app as `<@botUserId>`).
- `conversations(kinds)`: direct messages with the app (`im`) and channels (`public_channel`, `private_channel`),
  each with `isMember` (whether the app is in it), following Slack's pages.
- `history(channel, oldest)` and `replies(channel, threadTs, oldest)`: messages after a time stamp, oldest first. Thread
  replies are only in `replies`; Slack always gives a thread's first message there, which is left out unless it is
  after `oldest`.
- `user(id)`: a person's name and address (the address needs `users:read.email`).
- `permalink(channel, ts)`: a message's address for a person to open.
- `postMessage(channel, text, threadTs)`: plain text, escaped so it shows as written, in a thread when given.

Slack answers most failures with HTTP 200 and `{ ok: false, error }`: every refusal, a 429 and any other HTTP failure is
a `SlackApiError` naming the method and Slack's error code (`ratelimited` for a 429, with `retryAfter` in seconds from
Slack's `Retry-After`; `tokenRejected` for a wrong, revoked or removed token; `needed` for `missing_scope`). Nothing is
retried: the caller decides when to try again.

Helpers: `mentions(text, userId)`, `plainText(text, names)` (Slack's markup as plain text), `escapeText(text)`,
`compareTs(a, b)`, `tsOf(date)` and `isoOfTs(ts)` for Slack's "seconds.microseconds" time stamps.

Scopes an app needs for reading and answering requests: `channels:history`, `groups:history`, `im:history`,
`channels:read`, `groups:read`, `im:read`, `users:read`, `users:read.email`, `chat:write`.
