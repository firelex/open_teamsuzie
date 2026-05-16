# @teamsuzie/user-memory

Per-user long-lived memory store. Each user gets one markdown file
(`<memoryDir>/<userId-slug>.md`) the agent reads at the start of a
conversation and appends to over time.

## Scope

- **Long-lived** facts that carry over between sessions: firm name,
  drafting preferences, recurring deal patterns, voice quirks.
- **Not** a transcript of any single chat — for that, use
  `@teamsuzie/chats`.
- **Not** workspace-scoped — per-deal context belongs in the host app's
  workspace store.

Storage is plain markdown on disk so the user can inspect, edit, or
`grep` their memory directly. No DB schema, no migrations.

## Usage

```typescript
import { UserMemoryStore } from '@teamsuzie/user-memory';

const memory = new UserMemoryStore({
  memoryDir: path.resolve(__dirname, '../data/memory'),
});

// At the start of a conversation:
const facts = await memory.read(user.email);
// → appended to the system prompt

// When the model decides a fact is worth keeping:
await memory.append(user.email, 'User prefers tables for IC comparisons.');

// Explicit user-requested reset:
await memory.replace(user.email, '');
```

Each agent should wrap these methods in `read_user_memory` /
`append_user_memory` tools and instruct its persona about what's worth
saving (stable across sessions, not conversation-specific).
