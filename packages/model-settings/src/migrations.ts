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
];
