# @teamsuzie/email-simulator

One persona's mailbox in the local email simulator, for `@teamsuzie/email`. `SimulatorEmailClient` implements
`EmailClient` over the simulator's native REST API (`/v1/...`), sending the app key as a bearer token:

```ts
new SimulatorEmailClient({ baseUrl: 'http://127.0.0.1:8025', apiKey, userId, address });
```

Addresses and persona ids are translated both ways through `GET /v1/users`, cached and read again once when an id or
address is unknown; one still unknown is an error (an address that is no persona is never dropped). A message's id is
the simulator's email id, the same in every mailbox. Threads are the persona's inbox and sent folders grouped by
`thread_id`; inbox messages are labelled `INBOX`, sent ones `SENT`, and mail to oneself is listed once with both.

The sync cursor is `<generation>:<inbox seq>:<sent seq>`; a cursor from before a simulator reset throws
`EmailCursorExpiredError`. Changes are only `message_added`.

The simulator has no read flags or labels. Inbox messages are unread until `setRead` marks them, and `modifyLabels`
replaces a thread's labels, both in this client instance only: they are not sent to the simulator, are lost when the
client is rebuilt, and produce no changes. Mail is plain text (`html` is refused); `forward` and `createDraft` are not
offered. Errors: `EmailAuthError` (401, 403), `EmailNotFoundError` (404), `EmailRateLimitError` (429), otherwise
`SimulatorHttpError`, each with the status and the simulator's message.
