# @teamsuzie/email-webmail

One Gmail or Outlook account for `@teamsuzie/email`, read and written through its web page. `WebmailEmailClient`
implements `EmailClient` by running the account's route (`@teamsuzie/webmail-routes`) with a `RouteExecutor`
(`@teamsuzie/webmail-browser`):

| `EmailClient` | Route operation |
|---|---|
| `listMessages()` / `listMessages({ search })` | `list_inbox` / `search` |
| `getMessage(id)` | `open_message` (the message becomes read in the mailbox) |
| `getThread(id)` | `read_thread` |
| `send(input)` | `compose_send` (real Send) |
| `reply(input)` | `open_message`, then `reply` to `input.to` or the original sender |

Also: `readAccount()` (`read_account`), `confirmSent(subject, to)` (`check_sent`) and `testOperation(op, params)`
(test mode: never sends, discards drafts).

- Plain text only: `html`, attachments, reply-all and sending as another address throw `WebmailUnsupportedError`.
- Message ids are the ids the page uses (Gmail: the conversation id; Outlook: the conversation id). Dates are ISO
  timestamps, read in the machine's time zone.
- Each operation must return the fields in `OPERATION_OUTPUTS`; a route that does not is an `extract_invalid`
  `RouteError`, the same as any other route failure.
- `OPERATION_GOALS` says in plain English what each operation is for; the relearner gives it to the model.
- `SEED_ROUTES` are the starting Gmail and Outlook routes, taken from the hooks TeamSuzie's drivers used. They have
  not been checked against live accounts here; the first canary relearns whatever no longer matches.
- `FileRouteStore` keeps `<dir>/<provider>/current.json` plus every saved version in `history/`.
- `runCanary(client, only?)` runs operations in test mode on the live account and reports passed / failed / skipped
  per operation. Sign-outs and page-load failures are thrown, not reported as route failures.
