import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Per-user model-endpoint overrides. Composite primary key
 * `(owner_id, model_id)` so a user gets at most one override per model.
 *
 * Apps add this to their `openDb({ migrations })` call alongside their other
 * migrations — same pattern as `PERSONAS_MIGRATIONS`.
 */
export const MODEL_SETTINGS_MIGRATIONS: Migration[] = [
  {
    name: '20260428_create_model_settings',
    up: `
      CREATE TABLE IF NOT EXISTS model_settings (
        owner_id   TEXT NOT NULL,
        model_id   TEXT NOT NULL,
        base_url   TEXT NOT NULL,
        api_key    TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, model_id)
      );
    `,
  },
  {
    // Per-user, per-provider API keys for cloud BYOK (M1). Distinct from
    // `model_settings` (which is per-model URL+key for local hosting).
    // Provider ids are opaque strings — the host app maps cloud-model
    // entries to a provider id (e.g. 'openai', 'dashscope') and resolves
    // the actual base URL on the server side.
    name: '20260504_create_provider_keys',
    up: `
      CREATE TABLE IF NOT EXISTS provider_keys (
        owner_id    TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        api_key     TEXT NOT NULL,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (owner_id, provider_id)
      );
    `,
  },
  {
    // Optional per-(owner, provider) base URL override and a stored model
    // hint. Hosts that ship a `providerCatalog` use the catalog's
    // `defaultBaseUrl` when these are null. The model column is used by the
    // `resolveDefault` flow when the default-model selection picks this
    // provider — see `model_settings_meta.default_model`.
    name: '20260525_provider_keys_add_base_url_model',
    up: `
      ALTER TABLE provider_keys ADD COLUMN base_url TEXT;
      ALTER TABLE provider_keys ADD COLUMN model TEXT;
    `,
  },
  {
    // Small key/value table for misc per-owner settings. First consumer:
    // 'default_model' — the model id the runtime resolves credentials for
    // when no per-request override is given. Kept generic so the suite-host
    // wrapper can store its own knobs without another migration.
    name: '20260525_create_model_settings_meta',
    up: `
      CREATE TABLE IF NOT EXISTS model_settings_meta (
        owner_id   TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, key)
      );
    `,
  },
];
