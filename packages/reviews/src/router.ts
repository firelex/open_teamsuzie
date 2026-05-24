import { Router, type Request } from 'express';

import type { ReviewsStore } from './store.js';
import type { ReviewColumn } from './types.js';

const KNOWN_FORMATS = new Set([
  'text',
  'number',
  'boolean',
  'date',
  'tags',
  'currency',
]);

function parseColumns(raw: unknown): ReviewColumn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ReviewColumn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    const prompt = typeof e.prompt === 'string' ? e.prompt.trim() : '';
    const formatRaw = typeof e.format === 'string' ? e.format.trim() : '';
    const format = (KNOWN_FORMATS.has(formatRaw) ? formatRaw : 'text') as ReviewColumn['format'];
    if (!id || !title) continue;
    out.push({ id, title, prompt, format });
  }
  return out;
}

function parseRows(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    out.push(entry as Record<string, unknown>);
  }
  return out;
}

export interface CreateReviewsRouterOptions {
  store: ReviewsStore;
  /**
   * Resolve the current owner (e.g. user email) from the request.
   * Returns `null` for unauthenticated calls — the router responds 401
   * for endpoints that require an owner. Hosts mounting behind their
   * own auth middleware can return a guaranteed-non-null value.
   */
  getOwnerId: (req: Request) => string | null | undefined;
}

/**
 * REST endpoints for the reviews library:
 *
 *   GET    /templates          — list templates visible to the user
 *                                (?includeArchived=1 includes archived)
 *   POST   /templates          — create a user template
 *                                ({ name, description?, columns })
 *   PATCH  /templates/:id      — update (user-owned only)
 *   DELETE /templates/:id      — delete (user-owned only)
 *
 *   GET    /                   — list reviews owned by the user
 *                                (?includeArchived=1 includes archived)
 *   POST   /                   — create a review
 *                                ({ name, templateId?, rows? })
 *   GET    /:id                — get one (owner-only)
 *   PATCH  /:id                — update (owner-only; replace rows / rename)
 *   DELETE /:id                — delete (owner-only)
 *
 * System templates are seeded into the table by the host at startup
 * (via `store.seedSystemTemplates(...)`) — they're not editable through
 * this router.
 */
export function createReviewsRouter(opts: CreateReviewsRouterOptions): Router {
  const { store, getOwnerId } = opts;
  const router: Router = Router();

  function ownerOr401(req: Request): string | null {
    const id = getOwnerId(req);
    if (!id) return null;
    return id;
  }

  // --- Templates ------------------------------------------------------

  router.get('/templates', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const includeArchived = req.query.includeArchived === '1';
    res.json({
      items: store.listTemplatesVisible({ ownerId, includeArchived }),
    });
  });

  router.post('/templates', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const description =
      typeof body?.description === 'string' ? body.description.trim() : undefined;
    const columns = parseColumns(body?.columns) ?? [];
    const template = store.createUserTemplate({
      ownerId,
      name,
      ...(description !== undefined ? { description } : {}),
      columns,
    });
    res.status(201).json({ item: template });
  });

  router.patch('/templates/:id', (req, res) => {
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
      columns?: ReviewColumn[];
    } = {};
    if (typeof body?.name === 'string') {
      const trimmed = body.name.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      patch.name = trimmed;
    }
    if (typeof body?.description === 'string') {
      patch.description = body.description.trim();
    }
    const columns = parseColumns(body?.columns);
    if (columns !== undefined) patch.columns = columns;
    const updated = store.updateUserTemplate(id, ownerId, patch);
    if (!updated) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ item: updated });
  });

  router.delete('/templates/:id', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const id = String(req.params.id ?? '');
    const ok = store.deleteUserTemplate(id, ownerId);
    if (!ok) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Reviews --------------------------------------------------------

  router.get('/', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const includeArchived = req.query.includeArchived === '1';
    res.json({
      items: store.listReviewsVisible({ ownerId, includeArchived }),
    });
  });

  router.post('/', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const templateId =
      typeof body?.templateId === 'string' && body.templateId
        ? body.templateId
        : null;
    const rows = parseRows(body?.rows) ?? [];
    const review = store.createUserReview({
      ownerId,
      name,
      templateId,
      rows,
    });
    res.status(201).json({ item: review });
  });

  router.get('/:id', (req, res) => {
    const ownerId = ownerOr401(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const id = String(req.params.id ?? '');
    const review = store.getReview(id, ownerId);
    if (!review) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ item: review });
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
      rows?: Array<Record<string, unknown>>;
    } = {};
    if (typeof body?.name === 'string') {
      const trimmed = body.name.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      patch.name = trimmed;
    }
    const rows = parseRows(body?.rows);
    if (rows !== undefined) patch.rows = rows;
    const updated = store.updateUserReview(id, ownerId, patch);
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
    const ok = store.deleteUserReview(id, ownerId);
    if (!ok) {
      res.status(404).json({ error: 'not_found_or_forbidden' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
