# @teamsuzie/model-settings

Per-user overrides for the local-model agent registry, plus optional BYOK (bring-your-own-key) cloud-provider credentials — a SQLite store and an Express router. Pairs with `@teamsuzie/agent-loop`'s `resolveAgentTarget` and `validateLocalAgentUrl`/`validateProviderUrl`. Use it when callers need to point a local model at their own endpoint, store their own cloud API keys, or pick a default model.

```ts
import express from 'express';
import { openDb } from '@teamsuzie/db-sqlite';
import { buildLocalAgentRegistry } from '@teamsuzie/agent-loop';
import {
  ModelSettingsStore,
  MODEL_SETTINGS_MIGRATIONS,
  createModelSettingsRouter,
  type ProviderDef,
} from '@teamsuzie/model-settings';

const db = openDb({ path: './data/app.db', migrations: MODEL_SETTINGS_MIGRATIONS });

const catalog: ProviderDef[] = [
  { key: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', models: ['gpt-4o'] },
];

const store = new ModelSettingsStore({
  db,
  envRegistry: buildLocalAgentRegistry(process.env),
  providerCatalog: catalog,
  scope: 'per-user',
});

const app = express();
app.use(
  '/api/model-settings',
  requireAuth,
  createModelSettingsRouter({
    store,
    getOwnerId: (req) => req.session?.user?.email ?? null,
  }),
);

// Resolve what a chat request should actually call.
const registry = store.effectiveRegistry('user@example.com');
```

## Main exports

- `ModelSettingsStore` — SQLite-backed store with two roles: per-model URL/key overrides for local models (`list`, `setOverride`, `clearOverride`, `effectiveRegistry`, `publicSettings`), and BYOK cloud-provider credentials (`getProviderKey`, `getProviderRecord`, `setProviderKey`, `clearProviderKey`, `publicProviderKeys`), plus a default-model selection (`getDefaultModel`, `setDefaultModel`, `resolveDefault`).
- `SUITE_OWNER_ID` — the sentinel owner id used when the store's `scope` is `'global'`.
- `createModelSettingsRouter` — REST endpoints: `GET /`, `PUT/DELETE /:modelId` (local overrides); `GET /providers`, `GET /providers/catalog`, `PUT/DELETE /providers/:id` (BYOK); `GET/PUT /default` (default-model selection); `GET /effective` (plaintext credentials, only mounted when `serviceTokenGuard` is supplied — internal/service-to-service only).
- `MODEL_SETTINGS_MIGRATIONS` — the `model_settings`, `provider_keys`, and `model_settings_meta` table migrations.
- Types: `ProviderDef`/`ProviderModelDef` (static cloud-provider catalog entries), `EncryptionAdapter`, `StoreScope`, `ResolvedDefault`, `ModelSettingPublic`, `ProviderKeyPublic`.

## Configuration

- `scope` (`'per-user'` default, or `'global'` for single-tenant installs, where every `ownerId` argument collapses to `SUITE_OWNER_ID`).
- `encryption` — an optional `EncryptionAdapter` (`encrypt`/`decrypt`) applied to stored API keys; the usual implementation binds `@teamsuzie/crypto`'s `encrypt`/`decrypt` to a secret from an env var such as `MODEL_SETTINGS_SECRET`. Stored ciphertext is tagged `enc:v1:`; if a row is encrypted but the store is built without an adapter, that key reads back as `null` rather than ciphertext.
- `createModelSettingsRouter`'s `allowLocalProviderUrl` (default `false`) permits localhost/private hosts for `PUT /providers/:id` — enable only in dev, for pointing BYOK at a local server.

## Notable behaviour

- `setOverride`/`setProviderKey` do not validate the URL themselves — callers must call `validateLocalAgentUrl` / `validateProviderUrl` from `@teamsuzie/agent-loop` first.
- `setProviderKey` throws if `apiKey` is empty/whitespace, and throws when creating a new provider row without ever supplying an `apiKey`; omitting a field on an update preserves its existing value.
- `setDefaultModel`/`resolveDefault` accept either a bare local-model id, a bare catalog model id (if uniquely findable), or an explicit `"{providerKey}:{modelId}"` string, and throw on anything unresolvable against the configured local models / provider catalog.
- API keys are never echoed back through `publicSettings`/`publicProviderKeys` — only a `hasKey`/`hasApiKey` boolean plus metadata.
