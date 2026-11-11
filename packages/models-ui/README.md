# @teamsuzie/models-ui

React client for the shared Models mechanism: a ready-made "Models" page where a user picks a hosted or local model and chats with it to test it. Built on `@teamsuzie/ui` and pairs with the server-side `@teamsuzie/models` package's `/api/models*` routes. Use it when a host app wants a drop-in model picker + test-chat page without building its own.

```tsx
import { ModelsPage } from '@teamsuzie/models-ui';

export function ModelsRoute() {
  return <ModelsPage />;
}
```

Building a custom picker from the same data:

```tsx
import { useEffect, useState } from 'react';
import { ModelPicker, fetchModels, type ModelInfo } from '@teamsuzie/models-ui';

function CustomPicker() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    fetchModels().then((r) => setModels(r.models));
  }, []);

  return <ModelPicker models={models} value={selected} onChange={setSelected} />;
}
```

## Main exports

- `ModelsPage()` — the full page: loads the model catalogue, restores the persisted default model, lets the user pick a model (persisting the choice as the app's workflow default) and chat with it. Shows a visible reason when no model is available rather than a silent empty screen.
- `MODELS_TESTIDS` — stable `data-testid` values used by `ModelsPage` (`page`, `picker`, `input`, `send`, `error`, `empty`, `message(i)`).
- `ModelPicker({ models, value, onChange, testid? })` — a `@teamsuzie/ui` `Select` listing models; unavailable models stay visible but disabled with the reason shown inline.
- `fetchModels(signal?)` — `GET /api/models`, returns `{ configured, setup, models, defaultModelId }`.
- `streamChat({ id, messages }, onDelta, signal?)` — `POST /api/models/chat`, streams an SSE-style (`data: {...}`) response and calls `onDelta` per text chunk; throws with the server's message if the stream carries an `error` event.

## Notable behaviour

- `ModelsPage` never asks for an API key itself — hosted models use keys the parent app already has configured; the empty-state message points at `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `DASHSCOPE_API_KEY`.
- Picking a model in `ModelsPage` both drives the chat and persists it as the default model the app's workflows use (`PUT /api/models/default`, via the internal `setDefaultModel`).
- `react` and `react-dom` (`^18 || ^19`) are peer dependencies, not bundled.

## Used by

`apps/starters/starter-workspace-app` (its client app and nav).
