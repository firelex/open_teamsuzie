import { Router, type Request } from 'express';

import type { WorkflowsStore } from './store.js';
import type { WorkflowColumnConfig, WorkflowOutputMode } from './types.js';
import { WORKFLOW_OUTPUT_MODES } from './types.js';

function parseOutputMode(raw: unknown): WorkflowOutputMode | undefined {
  if (typeof raw !== 'string') return undefined;
  return WORKFLOW_OUTPUT_MODES.includes(raw as WorkflowOutputMode)
    ? (raw as WorkflowOutputMode)
    : undefined;
}

function parseColumnConfig(raw: unknown): WorkflowColumnConfig[] | null | undefined {
  // Tri-valued: undefined → leave alone, null → clear, array → replace.
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const out: WorkflowColumnConfig[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    const prompt = typeof e.prompt === 'string' ? e.prompt.trim() : '';
    const format = typeof e.format === 'string' ? e.format.trim() : '';
    if (!title || !prompt || !format) continue;
    out.push({ title, prompt, format });
  }
  return out;
}

export interface CreateWorkflowsRouterOptions {
  store: WorkflowsStore;
  /**
   * Resolve the current owner (e.g. user email) from the request.
   * Returns `null` for unauthenticated calls — the router responds 401
   * for endpoints that require an owner. Hosts mounting behind their
   * own auth middleware can return a guaranteed-non-null value.
   */
  getOwnerId: (req: Request) => string | null | undefined;
}

/**
 * REST endpoints for the workflows library:
 *
 *   GET    /                           — list visible workflows for the user
 *                                        (?includeArchived=1 includes archived)
 *   GET    /hidden                     — ids the user has hidden
 *   POST   /                           — create a user workflow
 *                                        ({ name, description?, prompt, practiceAreas? })
 *   GET    /:id                        — get one
 *   PATCH  /:id                        — update (user-owned only)
 *   DELETE /:id                        — delete (user-owned only)
 *   POST   /:id/archive                — archive (user-owned only)
 *   POST   /:id/unarchive              — unarchive (user-owned only)
 *   POST   /:id/hide                   — hide a workflow from this user's view
 *   POST   /:id/unhide                 — undo a hide
 *
 * System workflows are seeded into the table by the host at startup
 * (via `store.seedSystem(...)`) — they're not editable through this
 * router.
 */
export function createWorkflowsRouter(opts: CreateWorkflowsRouterOptions): Router {
  const { store, getOwnerId } = opts;
  const router: Router = Router();

  function ownerOr401(req: Request): string | null {
    const id = getOwnerId(req);
    if (!id) return null;
    return id;
  }

  router.get('/', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const includeArchived = req.query.includeArchived === '1';
    res.json({
      items: store.listVisible({ ownerId, includeArchived }),
    });
  });

  router.get('/hidden', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.json({ items: store.listHiddenIds(ownerId) });
  });

  router.post('/', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name || '').trim();
    const prompt = String(body?.prompt || '').trim();
    if (!name || !prompt) {
      res.status(400).json({ error: 'name and prompt are required' });
      return;
    }
    const description =
      typeof body?.description === 'string' ? body.description.trim() : '';
    const practiceAreas = Array.isArray(body?.practiceAreas)
      ? (body.practiceAreas as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const columnConfig = parseColumnConfig(body?.columnConfig);
    const outputMode = parseOutputMode(body?.outputMode);
    const workflow = store.createUserWorkflow({
      ownerId,
      name,
      description,
      prompt,
      practiceAreas,
      columnConfig: columnConfig ?? null,
      ...(outputMode ? { outputMode } : {}),
    });
    res.status(201).json({ item: workflow });
  });

  router.get('/:id', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const id = String(req.params.id ?? '');
    const workflow = store.get(id);
    if (!workflow) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // User rows are private to their owner.
    if (workflow.source === 'user' && workflow.ownerId !== ownerId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ item: workflow });
  });

  router.patch('/:id', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const id = String(req.params.id ?? '');
    const body = req.body as Record<string, unknown> | undefined;
    const patch: {
      name?: string;
      description?: string;
      prompt?: string;
      practiceAreas?: string[];
      columnConfig?: WorkflowColumnConfig[] | null;
      outputMode?: WorkflowOutputMode;
    } = {};
    if (typeof body?.name === 'string') {
      const trimmed = body.name.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      patch.name = trimmed;
    }
    if (typeof body?.description === 'string') patch.description = body.description.trim();
    if (typeof body?.prompt === 'string') {
      const trimmed = body.prompt.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'prompt cannot be empty' });
        return;
      }
      patch.prompt = trimmed;
    }
    if (Array.isArray(body?.practiceAreas)) {
      patch.practiceAreas = (body.practiceAreas as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Accept `columnConfig`. `null` clears, array replaces, missing
    // leaves alone — mirror the store's tri-valued patch shape.
    if (body && Object.prototype.hasOwnProperty.call(body, 'columnConfig')) {
      const parsed = parseColumnConfig(body.columnConfig);
      if (parsed !== undefined) patch.columnConfig = parsed;
    }
    const outputMode = parseOutputMode(body?.outputMode);
    if (outputMode) patch.outputMode = outputMode;
    const updated = store.updateUserWorkflow(id, ownerId, patch);
    if (!updated) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ item: updated });
  });

  router.delete('/:id', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const id = String(req.params.id ?? '');
    const ok = store.deleteUserWorkflow(id, ownerId);
    if (!ok) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/:id/archive', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const ok = store.archive(String(req.params.id ?? ''), ownerId);
    if (!ok) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/:id/unarchive', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const ok = store.unarchive(String(req.params.id ?? ''), ownerId);
    if (!ok) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/:id/hide', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const id = String(req.params.id ?? '');
    if (!store.get(id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    store.hide(id, ownerId);
    res.json({ ok: true });
  });

  router.post('/:id/unhide', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    store.unhide(String(req.params.id ?? ''), ownerId);
    res.json({ ok: true });
  });

  return router;
}
