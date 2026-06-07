# @teamsuzie/email

Provider-agnostic email contracts for Team Suzie hosts and private adapters.

This package intentionally does not connect to Gmail, Outlook, SendGrid, browser
automation, hosted queues, or managed OAuth credentials. It defines the common
payloads and client interface that apps can depend on while choosing their own
implementation.

```typescript
import type { EmailClient } from '@teamsuzie/email';

export function installEmailRoutes(email: EmailClient) {
  // The host decides whether this is backed by SMTP, Resend, js-tools, etc.
}
```

Outbound actions default to the host adapter's normal approval behavior. Set
`approvalPolicy: 'bypass_approval'` only for trusted operational paths where the
host explicitly wants direct dispatch.
