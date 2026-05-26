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
  base_url: string | null;
  model: string | null;
  updated_at: number;
}

interface MetaRow {
  owner_id: string;
  key: string;
  value: string | null;
  updated_at: number;
}

/**
 * Public view of a per-(user, provider) BYOK key. The actual key is never
 * echoed back over the wire — only `hasKey` + `updatedAt`. When a provider
 * catalog is configured, `baseUrl` reflects the effective URL (owner override
 * or catalog default) and `model` is the stored default model hint.
 */
export interface ProviderKeyPublic {
  providerId: string;
  hasKey: boolean;
  /** Effective base URL: owner override → catalog default → null. */
  baseUrl: string | null;
  /** Whether the owner has stored an explicit baseUrl override. */
  hasBaseUrlOverride: boolean;
  /** Stored default-model hint for this provider, or null. */
  model: string | null;
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

/**
 * Per-model entry inside a {@link ProviderDef}. A bare-string model id is
 * also accepted in the options for ergonomics — the store normalizes both
 * shapes to this object.
 */
export interface ProviderModelDef {
  id: string;
  label?: string;
}

/**
 * Static catalog entry describing one cloud LLM provider. Mirrors PE's
 * `PROVIDERS` table shape so PE can be re-implemented as a thin wrapper.
 *
 * - `key`: stable id used in URLs (`/providers/:key`) and as the prefix in
 *   `default_model` strings of the form `"openai:gpt-4o"`.
 * - `defaultBaseUrl`: filled in when the owner sets only `apiKey`.
 *   Leave undefined to force the owner to supply their own URL (e.g. for a
 *   custom-provider escape hatch).
 * - `models`: known model ids. An empty array means "any model string the
 *   owner types is fine" — the picker UI degrades to a freeform input.
 */
export interface ProviderDef {
  key: string;
  label: string;
  defaultBaseUrl?: string;
  models?: ReadonlyArray<string | ProviderModelDef>;
}

/**
 * Pluggable encryption for credentials at rest. The store treats encrypt /
 * decrypt as opaque transforms — the default impl is
 * `@teamsuzie/crypto`'s `encrypt` / `decrypt` bound to a master key:
 *
 * ```ts
 * import { encrypt, decrypt } from '@teamsuzie/crypto';
 * const secret = process.env.MODEL_SETTINGS_SECRET!;
 * const encryption = {
 *   encrypt: (p) => encrypt(p, secret),
 *   decrypt: (c) => decrypt(c, secret),
 * };
 * ```
 *
 * Stored values are tagged with `enc:v1:` so that flipping encryption on
 * an existing DB is a no-op for old plaintext rows (they're returned as-is
 * until next write).
 */
export interface EncryptionAdapter {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export type StoreScope = 'per-user' | 'global';

export interface ResolvedDefault {
  /** "{provider}:{model}" form when resolved via the catalog, or the raw
   *  local model id when resolved via the local registry. */
  modelId: string;
  baseUrl: string;
  apiKey: string | null;
  /** The wire-level model id (without any "provider:" prefix). */
  model: string;
}

export interface ModelSettingsStoreOptions {
  db: DatabaseInstance;
  /** Env-default registry (e.g. from `buildLocalAgentRegistry`). User
   *  overrides are merged on top of this. */
  envRegistry: AgentTargetRegistry;
  /** Local-model catalog — defaults to upstream `LOCAL_MODELS` but apps can
   *  pass a custom set if they extend the model lineup. */
  localModels?: LocalModel[];
  /**
   * `'per-user'` (default): each owner gets their own row. Pass the user
   * id / email as the `ownerId` argument on every call.
   * `'global'`: one shared row set for the whole install. The `ownerId`
   * argument on every method is ignored and the {@link SUITE_OWNER_ID}
   * sentinel is used instead. See gap #1 in the design doc.
   */
  scope?: StoreScope;
  /**
   * Optional cloud-provider catalog. When set:
   *  - `publicProviderKeys()` enriches each row with catalog metadata.
   *  - The router exposes `GET /providers/catalog` and uses the catalog to
   *    short-circuit `defaultBaseUrl` when the owner only provides an
   *    apiKey.
   *  - `resolveDefault()` can map a stored "{provider}:{model}" default
   *    back to the right base URL + key.
   */
  providerCatalog?: ProviderDef[];
  /**
   * Optional credential encryption. Applied to `api_key` columns (in
   * `model_settings` and `provider_keys`). When absent, values are stored
   * plaintext (back-compat with existing deployments).
   */
  encryption?: EncryptionAdapter;
}

/**
 * Sentinel owner id used by `scope: 'global'` stores. Reads/writes from the
 * store collapse to this constant regardless of the `ownerId` argument the
 * caller passes. Exported so suite-wrapper hosts can write `getOwnerId: () =>
 * SUITE_OWNER_ID` if they prefer not to opt into the router's `scope`
 * convenience.
 */
export const SUITE_OWNER_ID = '__suite__';

const ENC_PREFIX = 'enc:v1:';

/**
 * SQLite-backed model + provider settings store.
 *
 * Two complementary roles:
 *
 *   1. Per-model URL/key overrides for the local-model agent registry —
 *      pairs with `@teamsuzie/agent-loop`'s `resolveAgentTarget`.
 *   2. BYOK cloud-provider credentials + an optional default-model hint
 *      and SSRF-validated base-URL overrides, driven by an optional
 *      {@link ProviderDef} catalog.
 *
 * Scope is set at construction (`'per-user'` default, `'global'` for
 * single-tenant installs). All `ownerId` arguments are ignored in global
 * mode — callers can pass anything (the empty string works) and reads/writes
 * collapse to {@link SUITE_OWNER_ID}.
 */
export class ModelSettingsStore {
  private readonly db: DatabaseInstance;
  private readonly envRegistry: AgentTargetRegistry;
  private readonly localModels: LocalModel[];
  private readonly localModelIds: Set<string>;
  private readonly scope: StoreScope;
  private readonly providerCatalog: ProviderDef[];
  private readonly providerById: Map<string, ProviderDef>;
  private readonly encryption?: EncryptionAdapter;

  constructor(opts: ModelSettingsStoreOptions) {
    this.db = opts.db;
    this.envRegistry = opts.envRegistry;
    this.localModels = opts.localModels ?? LOCAL_MODELS;
    this.localModelIds = new Set(this.localModels.map((m) => m.id));
    this.scope = opts.scope ?? 'per-user';
    this.providerCatalog = opts.providerCatalog ?? [];
    this.providerById = new Map(this.providerCatalog.map((p) => [p.key, p]));
    this.encryption = opts.encryption;
  }

  /** Returns the configured store scope. Routers use this to decide whether
   *  to require an authenticated owner or fall back to the sentinel. */
  getScope(): StoreScope {
    return this.scope;
  }

  /** Configured provider catalog (empty array if none was supplied). */
  getProviderCatalog(): ProviderDef[] {
    return this.providerCatalog;
  }

  /**
   * Normalize an incoming ownerId based on scope. In global mode every
   * caller-supplied id collapses to the sentinel; in per-user mode an
   * empty/null id is returned as-is so the call fails loudly upstream
   * (typically the router 401s before reaching the store).
   */
  private resolveOwner(ownerId: string | null | undefined): string {
    if (this.scope === 'global') return SUITE_OWNER_ID;
    return (ownerId ?? '') as string;
  }

  private wrap(plaintext: string | null): string | null {
    if (plaintext === null) return null;
    if (!this.encryption) return plaintext;
    return ENC_PREFIX + this.encryption.encrypt(plaintext);
  }

  private unwrap(stored: string | null): string | null {
    if (stored === null) return null;
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    if (!this.encryption) {
      // The DB has an encrypted blob but the store was constructed without
      // an adapter — treat as missing rather than echoing ciphertext to the
      // caller. This usually means the operator dropped the master key.
      return null;
    }
    return this.encryption.decrypt(stored.slice(ENC_PREFIX.length));
  }

  /** All saved overrides for one owner (decrypted). */
  list(ownerId: string | null | undefined): ModelSettingRow[] {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return [];
    const rows = prepareCached<[string], ModelSettingRow>(
      this.db,
      `SELECT * FROM model_settings WHERE owner_id = ? ORDER BY model_id`,
    ).all(owner);
    return rows.map((r) => ({ ...r, api_key: this.unwrap(r.api_key) }));
  }

  /** Insert or update an override for `(ownerId, modelId)`. Caller is
   *  responsible for validating `baseUrl` first (use `validateLocalAgentUrl`). */
  setOverride(
    ownerId: string | null | undefined,
    modelId: string,
    baseUrl: string,
    apiKey: string | null,
  ): void {
    const owner = this.resolveOwner(ownerId);
    if (!owner) throw new Error('ownerId required (per-user scope)');
    const now = Date.now();
    prepareCached<[string, string, string, string | null, number]>(
      this.db,
      `INSERT INTO model_settings (owner_id, model_id, base_url, api_key, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, model_id) DO UPDATE SET
         base_url = excluded.base_url,
         api_key = excluded.api_key,
         updated_at = excluded.updated_at`,
    ).run(owner, modelId, baseUrl, this.wrap(apiKey), now);
  }

  /** Drop the override — reverts to env defaults for that model. */
  clearOverride(ownerId: string | null | undefined, modelId: string): boolean {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return false;
    const result = prepareCached<[string, string]>(
      this.db,
      `DELETE FROM model_settings WHERE owner_id = ? AND model_id = ?`,
    ).run(owner, modelId);
    return result.changes > 0;
  }

  /**
   * Effective registry for one owner — env defaults overlaid with their
   * overrides. Pass this to `resolveAgentTarget` per chat request. When
   * `ownerId` is null in per-user mode, returns just the env registry
   * (single-tenant / unauthenticated path). In global mode the ownerId is
   * always coerced to the sentinel.
   */
  effectiveRegistry(ownerId: string | null | undefined): AgentTargetRegistry {
    const merged: AgentTargetRegistry = { ...this.envRegistry };
    const owner = this.resolveOwner(ownerId);
    if (!owner) return merged;
    for (const row of this.list(owner)) {
      merged[row.model_id] = {
        baseUrl: row.base_url,
        apiKey: row.api_key ?? merged[row.model_id]?.apiKey,
      };
    }
    return merged;
  }

  /**
   * Public summary for one owner — what the client gets back from
   * `GET /api/model-settings`. One row per known local model. API keys are
   * never included; the response only flags whether one is set.
   */
  publicSettings(ownerId: string | null | undefined): ModelSettingPublic[] {
    const owner = this.resolveOwner(ownerId);
    const userRows = owner
      ? new Map(this.list(owner).map((r) => [r.model_id, r]))
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
    return new Set(this.localModelIds);
  }

  // --- Provider keys (BYOK) ---------------------------------------------

  private readProviderRow(
    owner: string,
    providerId: string,
  ): ProviderKeyRow | undefined {
    const row = prepareCached<[string, string], ProviderKeyRow>(
      this.db,
      `SELECT * FROM provider_keys WHERE owner_id = ? AND provider_id = ?`,
    ).get(owner, providerId);
    if (!row) return undefined;
    return { ...row, api_key: this.unwrap(row.api_key) ?? '' };
  }

  /**
   * Return the owner's API key for a cloud provider, or null if unset.
   * Server-only — never round-trip this through the client.
   */
  getProviderKey(
    ownerId: string | null | undefined,
    providerId: string,
  ): string | null {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return null;
    const row = this.readProviderRow(owner, providerId);
    return row && row.api_key ? row.api_key : null;
  }

  /** Full decrypted provider row, or null if unset. Useful for resolvers
   *  that need the baseUrl override / model alongside the key. */
  getProviderRecord(
    ownerId: string | null | undefined,
    providerId: string,
  ): { apiKey: string; baseUrl: string | null; model: string | null; updatedAt: number } | null {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return null;
    const row = this.readProviderRow(owner, providerId);
    if (!row || !row.api_key) return null;
    return {
      apiKey: row.api_key,
      baseUrl: row.base_url,
      model: row.model,
      updatedAt: row.updated_at,
    };
  }

  /** All provider-key rows for one owner. Internal — use `publicProviderKeys`. */
  listProviderKeyRows(ownerId: string | null | undefined): ProviderKeyRow[] {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return [];
    const rows = prepareCached<[string], ProviderKeyRow>(
      this.db,
      `SELECT * FROM provider_keys WHERE owner_id = ? ORDER BY provider_id`,
    ).all(owner);
    return rows.map((r) => ({ ...r, api_key: this.unwrap(r.api_key) ?? '' }));
  }

  /**
   * Insert or update a provider record. Each field is optional in the
   * payload so callers can update just the apiKey or just the baseUrl
   * without clobbering the other.
   *
   * - `apiKey`: required on first write for the row to exist; subsequent
   *   writes that omit it preserve the existing value. Empty/whitespace
   *   string throws.
   * - `baseUrl`: explicit `null` clears the override; `undefined` leaves
   *   it alone. Caller validates the URL (use
   *   `validateProviderUrl({ policy: 'public-only' })`).
   * - `model`: explicit `null` clears; `undefined` leaves alone.
   */
  setProviderKey(
    ownerId: string | null | undefined,
    providerId: string,
    payload: { apiKey?: string; baseUrl?: string | null; model?: string | null } | string,
  ): void {
    const owner = this.resolveOwner(ownerId);
    if (!owner) throw new Error('ownerId required (per-user scope)');

    // Back-compat: original signature was `(ownerId, providerId, apiKey: string)`.
    const normalized: { apiKey?: string; baseUrl?: string | null; model?: string | null } =
      typeof payload === 'string' ? { apiKey: payload } : payload;

    let nextApiKey: string | null | undefined = undefined;
    if (normalized.apiKey !== undefined) {
      const trimmed = normalized.apiKey.trim();
      if (!trimmed) throw new Error('apiKey cannot be empty');
      nextApiKey = trimmed;
    }

    const existing = this.readProviderRow(owner, providerId);
    if (!existing && nextApiKey === undefined) {
      throw new Error('apiKey is required when creating a new provider row');
    }

    const finalApiKey = nextApiKey ?? existing!.api_key;
    const finalBaseUrl =
      normalized.baseUrl === undefined ? (existing?.base_url ?? null) : normalized.baseUrl;
    const finalModel =
      normalized.model === undefined ? (existing?.model ?? null) : normalized.model;

    const now = Date.now();
    prepareCached<[string, string, string, string | null, string | null, number]>(
      this.db,
      `INSERT INTO provider_keys (owner_id, provider_id, api_key, base_url, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, provider_id) DO UPDATE SET
         api_key = excluded.api_key,
         base_url = excluded.base_url,
         model = excluded.model,
         updated_at = excluded.updated_at`,
    ).run(owner, providerId, this.wrap(finalApiKey) ?? '', finalBaseUrl, finalModel, now);
  }

  /** Remove a provider key. Returns true if a row was removed. */
  clearProviderKey(
    ownerId: string | null | undefined,
    providerId: string,
  ): boolean {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return false;
    const result = prepareCached<[string, string]>(
      this.db,
      `DELETE FROM provider_keys WHERE owner_id = ? AND provider_id = ?`,
    ).run(owner, providerId);
    return result.changes > 0;
  }

  /**
   * Public summary of the owner's provider records. If a `providerCatalog`
   * was given at construction, the iteration order matches the catalog and
   * `baseUrl` falls back to the catalog's `defaultBaseUrl`. Otherwise the
   * legacy `providerIds` argument drives the result. The actual key value
   * is never included; only `hasKey` + metadata.
   */
  publicProviderKeys(
    ownerId: string | null | undefined,
    providerIds?: string[],
  ): ProviderKeyPublic[] {
    const ids =
      this.providerCatalog.length > 0
        ? this.providerCatalog.map((p) => p.key)
        : providerIds ?? [];
    const owner = this.resolveOwner(ownerId);
    const rows = owner
      ? new Map(this.listProviderKeyRows(owner).map((r) => [r.provider_id, r]))
      : new Map<string, ProviderKeyRow>();
    return ids.map((id) => {
      const row = rows.get(id);
      const catalog = this.providerById.get(id);
      const override = row?.base_url ?? null;
      const baseUrl = override ?? catalog?.defaultBaseUrl ?? null;
      return {
        providerId: id,
        hasKey: !!row && !!row.api_key,
        baseUrl,
        hasBaseUrlOverride: !!override,
        model: row?.model ?? null,
        updatedAt: row?.updated_at ?? 0,
      };
    });
  }

  // --- Meta (default model + misc kv) -----------------------------------

  /** Read a meta value, or null if unset. */
  getMeta(ownerId: string | null | undefined, key: string): string | null {
    const owner = this.resolveOwner(ownerId);
    if (!owner) return null;
    const row = prepareCached<[string, string], MetaRow>(
      this.db,
      `SELECT * FROM model_settings_meta WHERE owner_id = ? AND key = ?`,
    ).get(owner, key);
    return row ? row.value : null;
  }

  /** Upsert a meta value. Pass null to clear. */
  setMeta(ownerId: string | null | undefined, key: string, value: string | null): void {
    const owner = this.resolveOwner(ownerId);
    if (!owner) throw new Error('ownerId required (per-user scope)');
    const now = Date.now();
    prepareCached<[string, string, string | null, number]>(
      this.db,
      `INSERT INTO model_settings_meta (owner_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    ).run(owner, key, value, now);
  }

  /** Convenience: get the owner's default model id (or null). */
  getDefaultModel(ownerId: string | null | undefined): string | null {
    return this.getMeta(ownerId, 'default_model');
  }

  /**
   * Convenience: set the owner's default model id.
   *
   * Accepts either a bare model id (must be uniquely findable across local
   * models + provider catalog) or `"{providerKey}:{modelId}"` for explicit
   * provider selection. Throws when the value can't be resolved against the
   * configured catalog/local models.
   */
  setDefaultModel(ownerId: string | null | undefined, defaultModel: string | null): void {
    // Validate the owner up-front so callers don't get a "Unknown model"
    // for what is really an auth problem.
    if (this.scope === 'per-user' && !(ownerId ?? '')) {
      throw new Error('ownerId required (per-user scope)');
    }
    if (defaultModel !== null) {
      const trimmed = defaultModel.trim();
      if (!trimmed) throw new Error('default_model cannot be empty');
      this.assertKnownDefaultModel(trimmed);
      this.setMeta(ownerId, 'default_model', trimmed);
      return;
    }
    this.setMeta(ownerId, 'default_model', null);
  }

  private assertKnownDefaultModel(value: string): void {
    const split = value.indexOf(':');
    if (split > 0) {
      const provider = value.slice(0, split);
      const model = value.slice(split + 1);
      const def = this.providerById.get(provider);
      if (!def) throw new Error(`Unknown provider: ${provider}`);
      const models = (def.models ?? []).map(normalizeProviderModelId);
      if (models.length > 0 && !models.includes(model)) {
        throw new Error(`Model "${model}" not in provider "${provider}" catalog`);
      }
      return;
    }
    // Bare model id — accept local models or any catalog model.
    if (this.localModelIds.has(value)) return;
    for (const def of this.providerCatalog) {
      const models = (def.models ?? []).map(normalizeProviderModelId);
      if (models.includes(value)) return;
    }
    throw new Error(`Unknown model: ${value}`);
  }

  /**
   * Resolve the owner's default model into wire-level `{baseUrl, apiKey,
   * model}` for the internal `/effective` flow. Returns null when no
   * default is set or the stored default is no longer in the catalog.
   *
   * Resolution order:
   *  1. Local model — uses `effectiveRegistry` for baseUrl/apiKey.
   *  2. `"{provider}:{model}"` catalog hit — uses the provider's stored
   *     baseUrl override, falling back to its catalog `defaultBaseUrl`,
   *     and the owner's stored apiKey for that provider.
   *  3. Bare catalog model id (only when uniquely findable).
   */
  resolveDefault(ownerId: string | null | undefined): ResolvedDefault | null {
    const value = this.getDefaultModel(ownerId);
    if (!value) return null;

    // Local model path — defer to effectiveRegistry.
    if (this.localModelIds.has(value)) {
      const registry = this.effectiveRegistry(ownerId);
      const entry = registry[value];
      const fallback = this.localModels.find((m) => m.id === value)?.defaultBaseUrl;
      const baseUrl = entry?.baseUrl ?? fallback;
      if (!baseUrl) return null;
      return {
        modelId: value,
        baseUrl,
        apiKey: entry?.apiKey ?? null,
        model: value,
      };
    }

    const split = value.indexOf(':');
    let providerKey: string | null = null;
    let modelId: string | null = null;
    if (split > 0) {
      providerKey = value.slice(0, split);
      modelId = value.slice(split + 1);
    } else {
      // Bare catalog model — pick the first provider that lists it.
      for (const def of this.providerCatalog) {
        const models = (def.models ?? []).map(normalizeProviderModelId);
        if (models.includes(value)) {
          providerKey = def.key;
          modelId = value;
          break;
        }
      }
    }
    if (!providerKey || !modelId) return null;

    const def = this.providerById.get(providerKey);
    if (!def) return null;

    const record = this.getProviderRecord(ownerId, providerKey);
    const baseUrl = record?.baseUrl ?? def.defaultBaseUrl ?? null;
    if (!baseUrl) return null;

    return {
      modelId: `${providerKey}:${modelId}`,
      baseUrl,
      apiKey: record?.apiKey ?? null,
      model: modelId,
    };
  }
}

function normalizeProviderModelId(m: string | ProviderModelDef): string {
  return typeof m === 'string' ? m : m.id;
}
