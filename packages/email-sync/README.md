# @teamsuzie/email-sync

Keeps a local copy of a mailbox up to date, for hosts that show and search mail
themselves. The host supplies the storage (`MailStore`); this package supplies
the syncing and the cleaning.

```typescript
import { MailSync } from '@teamsuzie/email-sync';

const sync = new MailSync({ client, store, account: 'me@firm.com', onThreadChanged: (id) => refile(id) });
await sync.initialImport(200); // once
await sync.syncOnce();         // then on a timer
```

- The cursor moves only after every change is applied; a failure part-way is retried in full next time. Applying a message twice updates it rather than copying it.
- HTML is sanitised before it is stored (`sanitizeEmailHtml`): no scripts, event handlers, frames, forms, `javascript:` links, network-fetching CSS or remote images (each becomes `[image]`). Tables and inline styles stay.
- `emailText` gives each message's plain text and where its quoted history starts (Gmail quote blocks, blockquotes, "On … wrote:", `>` lines and Outlook's original-message headers).
- Attachment content is never stored; the host fetches it with the client's `openAttachment` when someone opens it.
- `MemoryMailStore` is a store for tests and demos.
