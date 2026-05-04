import { Router, type Request } from 'express';
import { validateLocalAgentUrl } from '@teamsuzie/agent-loop';
import type { ModelSettingsStore } from './store.js';

export interface CreateModelSettingsRouterOptions {
  store: ModelSettingsStore;
  /** Resolve the owner id (e.g. user email) from the request. Return
   *  null/undefined to reject as unauthorized. */
  getOwnerId: (req: Request) => string | null | undefined;
}

/**
 * Standard REST endpoints for per-user model overrides.
 *
 * Mount under any prefix (e.g. `app.use('/api/model-settings', requireAuth, createModelSettingsRouter(...))`):
 *  - `GET    /`            — public view of all known local models with the
 *                            user's effective `baseUrl` + `hasApiKey`
 *  - `PUT    /:modelId`    — set an override (validated against the local-
 *                            URL allowlist; rejects public hosts)
 *  - `DELETE /:modelId`    — clear the override, fall back to env default
 *
 * Unknown model ids are 404. Bodies follow the `ModelSettingPublic` shape
 * but the API key is *write-only* on `PUT` (input field `apiKey: string`)
 * and never echoed back.
 */
export function createModelSettingsRouter(opts: CreateModelSettingsRouterOptions): Router {
  const { store, getOwnerId } = opts;
  const known = store.knownModelIds();
  const router: Router = Router();

  router.get('/', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ settings: store.publicSettings(ownerId) });
  });

  router.put('/:modelId', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const modelId = req.params.modelId;
    if (!known.has(modelId)) {
      res.status(404).json({ error: 'unknown_model' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const baseUrlInput = String(body?.baseUrl || '').trim();
    const apiKeyInput = body?.apiKey;
    const apiKey = typeof apiKeyInput === 'string' && apiKeyInput.trim() ? apiKeyInput.trim() : null;

    const validation = validateLocalAgentUrl(baseUrlInput);
    if (!validation.ok || !validation.url) {
      res.status(400).json({ error: validation.reason ?? 'invalid_url' });
      return;
    }

    store.setOverride(ownerId, modelId, validation.url, apiKey);
    res.json({ settings: store.publicSettings(ownerId) });
  });

  router.delete('/:modelId', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const modelId = req.params.modelId;
    if (!known.has(modelId)) {
      res.status(404).json({ error: 'unknown_model' });
      return;
    }
    store.clearOverride(ownerId, modelId);
    res.json({ settings: store.publicSettings(ownerId) });
  });

  return router;
}
