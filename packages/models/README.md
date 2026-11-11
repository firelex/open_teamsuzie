# @teamsuzie/models

Shared model gateway for hosted providers (Anthropic, OpenAI, Qwen/DashScope) and any reachable local OpenAI-compatible runtime, using API keys inherited from the environment — the app never collects a key, it just lets the user pick a model. Use it when an app needs a single chat/streaming interface across hosted and local models, with unavailable models surfaced (not hidden) along with the reason.

```ts
import express from 'express';
import { ModelGateway, modelsRouter } from '@teamsuzie/models';

const gateway = new ModelGateway({
  // All deps are optional; env/fetch default to process.env/global fetch.
  listLocalRuntimes: async () => [
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', models: ['llama-3.1-8b'] },
  ],
});

const models = await gateway.listModels();
const reply = await gateway.chat({
  id: 'anthropic/claude-sonnet-5',
  messages: [{ role: 'user', content: 'Summarize this file.' }],
});

const app = express();
app.use('/api/models', modelsRouter(gateway));
```

## Main exports

- `ModelGateway` — `listModels`, `availableProviders`, `isConfigured`, `describeSetup`, `chat`, `stream` (async generator of text deltas), `chatDefault`, `getDefaultModelId`/`setDefaultModelId`, and `researchChat` (provider-native web search).
- `modelsRouter(gateway)` — mounts `GET /` (catalog + config status), `GET/PUT /default`, `POST /chat` (Server-Sent Events: `{text}` deltas, then `{done:true}`, or a visible `{error}` event).
- `hostedProviders`, `streamChat`, `chatOnce` — the provider-adapter layer (`providers.ts`); the only place that knows a provider's wire format.
- `curatedHostedModels` — the one-per-provider curated catalog (Claude Sonnet 5 / GPT-5.5 / Qwen 3.8-Max by default).
- `researchAnthropic`, `researchQwen`, `providerSupportsWebSearch`, `WebSearchUnsupportedError` — provider-native web-search research calls (`research.ts`).
- Types: `ModelInfo`, `ChatRequest`/`ChatResult`, `ChatMessage`, `ProviderId`, `LocalRuntime`, `GatewayDeps`, `DefaultModelStore`, `ProviderConfig`, `WireFormat`.

## Configuration

Hosted provider keys/URLs are read from the environment:

- `ANTHROPIC_API_KEY` (base URL override: `MODELS_ANTHROPIC_BASE_URL`, model: `MODELS_ANTHROPIC_MODEL`, label: `MODELS_ANTHROPIC_LABEL`)
- `OPENAI_API_KEY` (`MODELS_OPENAI_BASE_URL` / `MODELS_OPENAI_MODEL` / `MODELS_OPENAI_LABEL`)
- `DASHSCOPE_API_KEY` for Qwen (`MODELS_QWEN_BASE_URL` / `MODELS_QWEN_MODEL` / `MODELS_QWEN_LABEL`)

A missing key doesn't throw — the model shows up in `listModels()` with `available: false` and a `reason` string.

## Notable behaviour

- A model id is `"{provider}/{model}"`, or `"openai-compatible/{runtimeId}:{model}"` for a local runtime; `ModelGateway.resolve` throws on an id it can't parse or a key/runtime it can't find.
- `researchChat` throws `WebSearchUnsupportedError` for providers without native web search (only Anthropic and Qwen support it) — callers choose their own fallback; the gateway never silently degrades a research call.
- `setDefaultModelId` rejects an id that isn't currently an *available* model.
- No provider SDKs are used — adapters call `fetch` directly (injectable via `GatewayDeps.fetchImpl` for tests).

Used by `@teamsuzie/models-ui` and the `starter-workspace-app` example.
