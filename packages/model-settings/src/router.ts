import { Router, type Request, type RequestHandler, type Response } from 'express';
import { validateLocalAgentUrl, validateProviderUrl } from '@teamsuzie/agent-loop';
import { SUITE_OWNER_ID, type ModelSettingsStore } from './store.js';

export interface CreateModelSettingsRouterOptions {
  store: ModelSettingsStore;
  /**
   * Resolve the owner id (e.g. user email) from the request. Return
   * null/undefined to reject as unauthorized. Optional when the store was
   * constructed with `scope: 'global'` — the router falls back to the
   * `SUITE_OWNER_ID` sentinel so a suite-host wrapper doesn't need to wire
   * a no-op resolver.
   */
  getOwnerId?: (req: Request) => string | null | undefined;
  /**
   * Cloud provider ids the host supports for BYOK. Drives both the
   * `GET /providers` summary and the allow-list for `PUT /providers/:id`.
   * Empty list disables the BYOK endpoints entirely.
   *
   * Ignored when the store has a `providerCatalog` — the catalog's keys are
   * authoritative in that case.
   */
  providerIds?: string[];
  /**
   * Pass-through to `validateProviderUrl` for PUT /providers/:id baseUrl
   * updates. Set to `true` in dev to allow localhost / private hosts for
   * pointing at ollama / LM Studio. Defaults to false (public-only).
   */
  allowLocalProviderUrl?: boolean;
  /**
   * Optional middleware mounted on `GET /effective`. The effective resolver
   * exposes plaintext credentials and is intended for service-to-service
   * use only — wire `createServiceAuth({serviceKey})` or any other
   * service-token guard here. When omitted, `/effective` is NOT mounted.
   */
  serviceTokenGuard?: RequestHandler;
}

const DEFAULT_MODEL_META_KEY = 'default_model';

/**
 * Standard REST endpoints for model settings + BYOK provider credentials.
 *
 * Mount under any prefix (e.g.
 * `app.use('/api/model-settings', requireAuth, createModelSettingsRouter(...))`).
 *
 * Per-model local overrides:
 *  - `GET    /`                    — public view of all known local models
 *  - `PUT    /:modelId`            — set local override (local-only URL)
 *  - `DELETE /:modelId`            — clear local override
 *
 * Cloud BYOK providers:
 *  - `GET    /providers`           — owner key/url summary (with catalog metadata when configured)
 *  - `GET    /providers/catalog`   — static catalog (only when store has one)
 *  - `PUT    /providers/:id`       — set apiKey and/or baseUrl override (public-only URL)
 *  - `DELETE /providers/:id`       — clear the provider row
 *
 * Default-model selection (for the runtime's `/effective` flow):
 *  - `GET    /default`             — `{ default_model: string | null }`
 *  - `PUT    /default`             — body `{ default_model: string | null }`
 *
 * Internal-only:
 *  - `GET    /effective`           — gated by `serviceTokenGuard` (not mounted otherwise)
 */
export function createModelSettingsRouter(opts: CreateModelSettingsRouterOptions): Router {
  const { store } = opts;
  const known = store.knownModelIds();
  const catalog = store.getProviderCatalog();
  const isGlobal = store.getScope() === 'global';

  const providerIds =
    catalog.length > 0 ? catalog.map((p) => p.key) : (opts.providerIds ?? []);
  const knownProviders = new Set(providerIds);
  const router: Router = Router();

  // Resolve owner per request. In global mode, the sentinel always wins so
  // a host doesn't need a getOwnerId resolver at all — convenient for
  // single-tenant suite wrappers.
  function ownerFor(req: Request, res: Response): string | null {
    if (isGlobal) return SUITE_OWNER_ID;
    if (!opts.getOwnerId) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    const owner = opts.getOwnerId(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    return owner;
  }

  // --- Provider catalog (static) -----------------------------------------

  if (catalog.length > 0) {
    router.get('/providers/catalog', (_req, res) => {
      res.json({
        providers: catalog.map((p) => ({
          key: p.key,
          label: p.label,
          defaultBaseUrl: p.defaultBaseUrl ?? null,
          models: (p.models ?? []).map((m) =>
            typeof m === 'string' ? { id: m, label: m } : { id: m.id, label: m.label ?? m.id },
          ),
        })),
      });
    });
  }

  // --- BYOK provider keys -------------------------------------------------
  // Mounted before per-model routes so `/providers/...` doesn't get matched
  // as a `:modelId`.

  router.get('/providers', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    res.json({ providers: store.publicProviderKeys(owner, providerIds) });
  });

  router.put('/providers/:providerId', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    const providerId = req.params.providerId;
    if (!knownProviders.has(providerId)) {
      res.status(404).json({ error: 'unknown_provider' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const apiKeyRaw = body?.apiKey;
    const apiKey =
      typeof apiKeyRaw === 'string' && apiKeyRaw.trim() ? apiKeyRaw.trim() : undefined;

    let baseUrl: string | null | undefined = undefined;
    if ('baseUrl' in (body ?? {})) {
      const raw = body!.baseUrl;
      if (raw === null || raw === '') {
        baseUrl = null;
      } else if (typeof raw === 'string') {
        const validation = validateProviderUrl(raw, {
          policy: 'public-only',
          allowLocalOverride: opts.allowLocalProviderUrl === true,
        });
        if (!validation.ok || !validation.url) {
          res.status(400).json({ error: validation.reason ?? 'invalid_url' });
          return;
        }
        baseUrl = validation.url;
      } else {
        res.status(400).json({ error: 'baseUrl must be a string, null, or omitted' });
        return;
      }
    }

    let model: string | null | undefined = undefined;
    if ('model' in (body ?? {})) {
      const raw = body!.model;
      if (raw === null || raw === '') {
        model = null;
      } else if (typeof raw === 'string') {
        model = raw.trim() || null;
      } else {
        res.status(400).json({ error: 'model must be a string, null, or omitted' });
        return;
      }
    }

    // Apply: if nothing meaningful was sent, complain so the caller doesn't
    // think a no-op write happened silently.
    if (apiKey === undefined && baseUrl === undefined && model === undefined) {
      res.status(400).json({ error: 'apiKey, baseUrl, or model is required' });
      return;
    }

    try {
      store.setProviderKey(owner, providerId, { apiKey, baseUrl, model });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid_payload' });
      return;
    }
    res.json({ providers: store.publicProviderKeys(owner, providerIds) });
  });

  router.delete('/providers/:providerId', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    const providerId = req.params.providerId;
    if (!knownProviders.has(providerId)) {
      res.status(404).json({ error: 'unknown_provider' });
      return;
    }
    store.clearProviderKey(owner, providerId);
    res.json({ providers: store.publicProviderKeys(owner, providerIds) });
  });

  // --- Default model selection -------------------------------------------

  router.get('/default', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    res.json({ [DEFAULT_MODEL_META_KEY]: store.getDefaultModel(owner) });
  });

  router.put('/default', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    const body = req.body as Record<string, unknown> | undefined;
    const raw = body?.[DEFAULT_MODEL_META_KEY];
    if (raw !== null && typeof raw !== 'string') {
      res.status(400).json({ error: 'default_model must be a string or null' });
      return;
    }
    try {
      store.setDefaultModel(owner, raw as string | null);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid_payload' });
      return;
    }
    res.json({ [DEFAULT_MODEL_META_KEY]: store.getDefaultModel(owner) });
  });

  // --- Internal: effective resolver --------------------------------------

  if (opts.serviceTokenGuard) {
    router.get('/effective', opts.serviceTokenGuard, (req, res) => {
      // Service-token requests aren't tied to a user session. In global
      // scope the sentinel works as-is; in per-user mode the service must
      // identify which owner it's resolving on behalf of, via header.
      let owner: string | null;
      if (isGlobal) {
        owner = SUITE_OWNER_ID;
      } else {
        const headerOwner = req.header('x-owner-id');
        if (!headerOwner) {
          res.status(400).json({ error: 'x-owner-id header required' });
          return;
        }
        owner = headerOwner;
      }
      const resolved = store.resolveDefault(owner);
      if (!resolved) {
        res.status(404).json({ error: 'no_default_model_configured' });
        return;
      }
      res.json({
        base_url: resolved.baseUrl,
        api_key: resolved.apiKey,
        model: resolved.model,
        model_id: resolved.modelId,
      });
    });
  }

  // --- Per-model local overrides -----------------------------------------

  router.get('/', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    res.json({ settings: store.publicSettings(owner) });
  });

  router.put('/:modelId', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    const modelId = req.params.modelId;
    if (!known.has(modelId)) {
      res.status(404).json({ error: 'unknown_model' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const baseUrlInput = String(body?.baseUrl || '').trim();
    const apiKeyInput = body?.apiKey;
    const apiKey =
      typeof apiKeyInput === 'string' && apiKeyInput.trim() ? apiKeyInput.trim() : null;

    const validation = validateLocalAgentUrl(baseUrlInput);
    if (!validation.ok || !validation.url) {
      res.status(400).json({ error: validation.reason ?? 'invalid_url' });
      return;
    }

    store.setOverride(owner, modelId, validation.url, apiKey);
    res.json({ settings: store.publicSettings(owner) });
  });

  router.delete('/:modelId', (req, res) => {
    const owner = ownerFor(req, res);
    if (!owner) return;
    const modelId = req.params.modelId;
    if (!known.has(modelId)) {
      res.status(404).json({ error: 'unknown_model' });
      return;
    }
    store.clearOverride(owner, modelId);
    res.json({ settings: store.publicSettings(owner) });
  });

  return router;
}
