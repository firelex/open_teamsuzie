# @teamsuzie/config-client

Scoped config resolver. Reads the current value for a config key by walking the scope hierarchy.

## Resolution order

```
agent scope → org scope → global scope → hardcoded default
```

First non-null wins.

## Example

```typescript
import { ConfigClient } from '@teamsuzie/config-client';

const config = new ConfigClient({ adminUrl, apiKey });

const modelName = await config.get('llm.default_model', {
  agentId,
  orgId,
  defaultValue: 'claude-sonnet-4-6',
});
```

## What this is not

- Not a config *store*. Writes go through the admin service.
- Not a secrets manager. Sensitive values are encrypted at rest by the admin service using `CONFIG_ENCRYPTION_KEY`, but this client decrypts transparently — treat it as in-memory plaintext.

## Status

v0.1 — being extracted.
