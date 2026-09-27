# @teamsuzie/email-fixture

An in-memory mailbox loaded from a JSON file. It implements `EmailClient` from
`@teamsuzie/email`, including the thread-level members, so email features can
be built, demonstrated and tested without a real account.

```typescript
import { FixtureEmailClient } from '@teamsuzie/email-fixture';

const mail = new FixtureEmailClient(JSON.parse(readFileSync('inbox.json', 'utf8')));
mail.deliver('t2', { id: 'm9', subject: 'RE: Signing', from: 'ben@hawk.com', to: 'me@firm.com', date: new Date().toISOString(), bodyText: 'Monday?', unread: true });
```

- The file is checked when loaded; an error names the thread and message at fault.
- `deliver` simulates a new message; `setRead` and `modifyLabels` change state; all three show up in `changesSince`.
- `send`, `reply`, `replyAll` and `forward` append an outbound message to the thread and record the call in `sent`. They send nothing anywhere. `approvalPolicy` is ignored: approval is the host's job.
- `getThread` never includes attachment content; `openAttachment` returns it.
