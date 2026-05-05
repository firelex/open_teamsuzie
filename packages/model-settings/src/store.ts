import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import {
  LOCAL_MODELS,
  type AgentTargetRegistry,
  type LocalModel,
} from '@teamsuzie/agent-loop';

interface ModelSettingRow {
  owner_id: string;
  model_id: string;
  base_url: string;
  api_key: string | null;
  updated_at: number;
}

interface ProviderKeyRow {
  owner_id: string;
  provider_id: string;
  api_key: string;
  updated_at: number;
}

/**
 * Public view of a per-(user, provider) BYOK key. The actual key is never
 * echoed back over the wire — only `hasKey` + `updatedAt`.
 */
export interface ProviderKeyPublic {
  providerId: string;
  hasKey: boolean;
  updatedAt: number;
}

/**
 * Public-shape view of an effective model setting — what the client sees
 * via `GET /api/model-settings`. Does *not* include the API key (only a
 * boolean indicating whether one is set). Apps should never round-trip the
 * key through the client.
 */
export interface ModelSettingPublic {
  modelId: string;
  baseUrl: string;
  hasApiKey: boolean;
  /** Epoch ms when this user last saved an override. 0 means using defaults. */
  updatedAt: number;
  /** True when this row's values come from a user override; false when from
   *  the env defaults / `LOCAL_MODELS` fallback. */
  isUserOverride: boolean;
}

export interface ModelSettingsStoreOptions {
  db: DatabaseInstance;
  /** Env-default registry (e.g. from `buildLocalAgentRegistry`). User
   *  overrides are merged on top of this. */
  envRegistry: AgentTargetRegistry;
  /** Local-model catalog — defaults to upstream `LOCAL_MODELS` but apps can
   *  pass a custom set if they extend the model lineup. */
  localModels?: LocalModel[];
}

/**
 * SQLite-backed per-user overrides for the local-model agent registry.
 *
 * Pair with `@teamsuzie/agent-loop`'s `resolveAgentTarget`: on every chat
 * turn, call `effectiveRegistry(ownerId)` and pass the result as the
 * registry argument. The store handles owner scoping; `validateLocalAgentUrl`
 * (also from agent-loop) is the safety bar for `setOverride`.
 */
export class ModelSettingsStore {
  private readonly db: DatabaseInstance;
  private readonly envRegistry: AgentTargetRegistry;
  private readonly localModels: LocalModel[];

  constructor(opts: ModelSettingsStoreOptions) {
    this.db = opts.db;
    this.envRegistry = opts.envRegistry;
    this.localModels = opts.localModels ?? LOCAL_MODELS;
  }

  /** All saved overrides for one user. */
  list(ownerId: string): ModelSettingRow[] {
    return prepareCached<[string], ModelSettingRow>(
      this.db,
      `SELECT * FROM model_settings WHERE owner_id = ? ORDER BY model_id`,
    ).all(ownerId);
  }

  /** Insert or update an override for `(ownerId, modelId)`. Caller is
   *  responsible for validating `baseUrl` first (use `validateLocalAgentUrl`). */
  setOverride(ownerId: string, modelId: string, baseUrl: string, apiKey: string | null): void {
    const now = Date.now();
    prepareCached<[string, string, string, string | null, number]>(
      this.db,
      `INSERT INTO model_settings (owner_id, model_id, base_url, api_key, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, model_id) DO UPDATE SET
         base_url = excluded.base_url,
         api_key = excluded.api_key,
         updated_at = excluded.updated_at`,
    ).run(ownerId, modelId, baseUrl, apiKey, now);
  }

  /** Drop the override — reverts to env defaults for that model. */
  clearOverride(ownerId: string, modelId: string): boolean {
    const result = prepareCached<[string, string]>(
      this.db,
      `DELETE FROM model_settings WHERE owner_id = ? AND model_id = ?`,
    ).run(ownerId, modelId);
    return result.changes > 0;
  }

  /**
   * Effective registry for one user — env defaults overlaid with their
   * overrides. Pass this to `resolveAgentTarget` per chat request. When
   * `ownerId` is null, returns just the env registry (single-tenant /
   * unauthenticated path).
   */
  effectiveRegistry(ownerId: string | null): AgentTargetRegistry {
    const merged: AgentTargetRegistry = { ...this.envRegistry };
    if (!ownerId) return merged;
    for (const row of this.list(ownerId)) {
      merged[row.model_id] = {
        baseUrl: row.base_url,
        apiKey: row.api_key ?? merged[row.model_id]?.apiKey,
      };
    }
    return merged;
  }

  /**
   * Public summary for one user — what the client gets back from
   * `GET /api/model-settings`. One row per known local model. API keys are
   * never included; the response only flags whether one is set.
   */
  publicSettings(ownerId: string | null): ModelSettingPublic[] {
    const userRows = ownerId
      ? new Map(this.list(ownerId).map((r) => [r.model_id, r]))
      : new Map<string, ModelSettingRow>();
    return this.localModels.map((m) => {
      const userRow = userRows.get(m.id);
      if (userRow) {
        return {
          modelId: m.id,
          baseUrl: userRow.base_url,
          hasApiKey: !!userRow.api_key,
          updatedAt: userRow.updated_at,
          isUserOverride: true,
        };
      }
      const env = this.envRegistry[m.id];
      return {
        modelId: m.id,
        baseUrl: env?.baseUrl ?? m.defaultBaseUrl,
        hasApiKey: !!env?.apiKey,
        updatedAt: 0,
        isUserOverride: false,
      };
    });
  }

  /** Set of model ids the store will accept overrides for. */
  knownModelIds(): Set<string> {
    return new Set(this.localModels.map((m) => m.id));
  }

  // --- Provider keys (BYOK) ---------------------------------------------

  /**
   * Return the user's API key for a cloud provider, or null if unset.
   * Server-only — never round-trip this through the client.
   */
  getProviderKey(ownerId: string, providerId: string): string | null {
    const row = prepareCached<[string, string], ProviderKeyRow>(
      this.db,
      `SELECT * FROM provider_keys WHERE owner_id = ? AND provider_id = ?`,
    ).get(ownerId, providerId);
    return row ? row.api_key : null;
  }

  /** All provider-key rows for one user. Internal — use `publicProviderKeys`. */
  listProviderKeyRows(ownerId: string): ProviderKeyRow[] {
    return prepareCached<[string], ProviderKeyRow>(
      this.db,
      `SELECT * FROM provider_keys WHERE owner_id = ? ORDER BY provider_id`,
    ).all(ownerId);
  }

  /** Insert or update a provider key. Empty/whitespace key throws. */
  setProviderKey(ownerId: string, providerId: string, apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error('apiKey cannot be empty');
    const now = Date.now();
    prepareCached<[string, string, string, number]>(
      this.db,
      `INSERT INTO provider_keys (owner_id, provider_id, api_key, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_id, provider_id) DO UPDATE SET
         api_key = excluded.api_key,
         updated_at = excluded.updated_at`,
    ).run(ownerId, providerId, trimmed, now);
  }

  /** Remove a provider key. Returns true if a row was removed. */
  clearProviderKey(ownerId: string, providerId: string): boolean {
    const result = prepareCached<[string, string]>(
      this.db,
      `DELETE FROM provider_keys WHERE owner_id = ? AND provider_id = ?`,
    ).run(ownerId, providerId);
    return result.changes > 0;
  }

  /**
   * Public summary of the user's provider keys. The set of providers is
   * driven by the host — pass the `providerIds` they care about (typically
   * a hardcoded list of cloud providers the app supports). Each entry has
   * `hasKey` so the client can render a "Set key" / "Update key" affordance.
   * The actual key is never included.
   */
  publicProviderKeys(
    ownerId: string | null,
    providerIds: string[],
  ): ProviderKeyPublic[] {
    const rows = ownerId
      ? new Map(this.listProviderKeyRows(ownerId).map((r) => [r.provider_id, r]))
      : new Map<string, ProviderKeyRow>();
    return providerIds.map((id) => {
      const row = rows.get(id);
      return {
        providerId: id,
        hasKey: !!row,
        updatedAt: row?.updated_at ?? 0,
      };
    });
  }
}
