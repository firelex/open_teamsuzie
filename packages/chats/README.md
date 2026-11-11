# @teamsuzie/chats

SQLite schema + CRUD for persisted chats and their messages, typically
scoped to a workspace (matter / project / case). Use it when an app needs
to save chat history — list past chats, append messages, rename, clear, or
delete — rather than keeping conversations in memory only.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { CHATS_MIGRATIONS, ChatsStore, createChatsRouter } from '@teamsuzie/chats';

const db = openDb({ path: './data/app.db', migrations: CHATS_MIGRATIONS });
const store = new ChatsStore({ db });

const chat = store.createChat({ workspaceId: 'matter-1', name: 'Research questions' });

store.appendMessage({ chatId: chat.id, role: 'user', content: 'What is the notice period?' });
store.appendMessage({
  chatId: chat.id,
  role: 'assistant',
  content: 'The notice period is 30 days. [1]',
  citations: JSON.stringify([{ id: 1, doc: 'doc_1', quote: '30 days notice' }]),
});

store.listMessages(chat.id);
store.listChats('matter-1'); // newest-updated first

app.use(
  '/api/matters/:matterId/chats',
  createChatsRouter({ store, getWorkspaceId: (req) => req.params.matterId }),
);
```

## Main exports

- `ChatsStore` — `createChat`, `getChat`, `listChats` (newest `updatedAt`
  first), `updateChat` (rename and/or switch persona), `touchChat` (bump
  `updatedAt` without other changes), `deleteChat` (cascades to messages),
  `appendMessage` (also touches the parent chat), `getMessage`,
  `listMessages` (oldest to newest), `clearMessages`.
- `CHATS_MIGRATIONS` — pass to `openDb({ migrations })` from
  `@teamsuzie/db-sqlite`.
- `createChatsRouter` — REST endpoints: `GET /`, `POST /`, `GET /:chatId`,
  `GET /:chatId/messages`, `PATCH /:chatId`, `DELETE /:chatId/messages`,
  `DELETE /:chatId`. Streaming a new message through the model is the
  host's job; the router only persists via `store.appendMessage`.
- `Chat`, `ChatMessage`, `ChatMessageRole` (`'user' | 'assistant'`),
  `CreateChatInput`, `UpdateChatInput`, `AppendMessageInput`.

## Notable behaviour

- `personaId` on `Chat` is opaque — the package never resolves it, the
  host app does. `UpdateChatInput.personaId` is tri-valued: omit to leave
  unchanged, pass `null` to clear it, pass a string to switch it.
- `toolEvents` and `citations` on `ChatMessage` are raw JSON strings (or
  `null`) the caller parses; this package doesn't interpret their shape.
- `listMessages` orders by `(created_at, id)` so same-millisecond inserts
  stay in insertion order.
