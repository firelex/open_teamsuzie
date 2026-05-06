import { Router, type Request } from 'express';
import type { PersonaRegistry } from './registry.js';
import type { Persona } from './types.js';

function byNameAsc(a: Persona, b: Persona): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export interface CreatePersonasRouterOptions {
  registry: PersonaRegistry;
  /** Extract the owner id (e.g. user email or numeric id) from the request.
   *  Return null/undefined to reject as unauthorized. The registry will
   *  scope reads/writes to whatever id this returns. */
  getOwnerId: (req: Request) => string | null | undefined;
}

/**
 * Standard REST endpoints for persona management. Mount under any prefix
 * (e.g. `app.use('/api/personas', requireAuth, createPersonasRouter(...))`).
 *
 * Endpoints:
 *  - `GET    /`        — list builtins + caller's user personas
 *  - `GET    /:id`     — fetch one (caller-scoped — 404 if it's another user's)
 *  - `POST   /`        — create a user persona
 *  - `PATCH  /:id`     — update a user persona (builtins are immutable → 403)
 *  - `DELETE /:id`     — delete a user persona
 *
 * Bodies use the persona shape from `@teamsuzie/personas`. `id`, `source`,
 * `ownerId`, and timestamps are server-managed; clients ignore/omit them on
 * write.
 */
export function createPersonasRouter(opts: CreatePersonasRouterOptions): Router {
  const { registry, getOwnerId } = opts;
  const router: Router = Router();

  router.get('/', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // source: 'all' (default) | 'builtin' | 'user'.
    // page/pageSize only apply to user personas — builtins are bounded.
    const sourceRaw = String(req.query.source ?? 'all');
    const source: 'all' | 'builtin' | 'user' =
      sourceRaw === 'builtin' || sourceRaw === 'user' ? sourceRaw : 'all';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.max(
      1,
      Math.min(200, parseInt(String(req.query.pageSize ?? '24'), 10) || 24),
    );
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    // Pagination is opt-in: callers that want the full list (e.g. the
    // sidebar persona picker) omit page/pageSize entirely. Editors that
    // want paged results pass them.
    const wantPaging =
      req.query.page !== undefined || req.query.pageSize !== undefined;

    // Case-insensitive name+description substring match for builtins. The
    // user store applies the same filter via SQL.
    const matchesQ = (text: string) =>
      !q || text.toLowerCase().includes(q.toLowerCase());

    if (source === 'builtin') {
      // Once a user is seeded the file-based built-ins are no longer their
      // canonical copies — they own editable duplicates. Hide the originals
      // so they don't show up twice in the editor.
      const all = registry.isSeeded(ownerId)
        ? []
        : registry
            .listBuiltins()
            .filter((p) => matchesQ(p.name) || matchesQ(p.description))
            .sort(byNameAsc);
      if (wantPaging) {
        const start = (page - 1) * pageSize;
        res.json({
          items: all.slice(start, start + pageSize),
          total: all.length,
          page,
          pageSize,
        });
        return;
      }
      res.json({ items: all, total: all.length });
      return;
    }

    if (source === 'user') {
      const total = registry.countForOwner(ownerId, { q });
      if (wantPaging) {
        const items = registry.listForOwner(ownerId, {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          q,
        });
        res.json({ items, total, page, pageSize });
        return;
      }
      // Unpaged user listing — used when callers want the full list.
      const items = registry.listForOwner(ownerId, { q });
      res.json({ items, total });
      return;
    }

    // 'all' — flat alphabetical list. Once a user is seeded their editable
    // copies replace the file-based originals, so we skip the builtin tier.
    // For pre-seed users we still merge.
    const builtins = registry.isSeeded(ownerId)
      ? []
      : registry
          .listBuiltins()
          .filter((p) => matchesQ(p.name) || matchesQ(p.description));
    const userItems = registry.listForOwner(ownerId, { q });
    const merged = [...builtins, ...userItems].sort(byNameAsc);
    if (wantPaging) {
      const start = (page - 1) * pageSize;
      res.json({
        items: merged.slice(start, start + pageSize),
        total: merged.length,
        page,
        pageSize,
      });
      return;
    }
    res.json({ items: merged, total: merged.length });
  });

  router.get('/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const persona = registry.get(req.params.id, ownerId);
    if (!persona) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ item: persona });
  });

  router.post('/', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const validation = validateCreate(body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    try {
      const persona = registry.create({ ownerId, ...validation.input });
      res.status(201).json({ item: persona });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'create_failed' });
    }
  });

  router.patch('/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const existing = registry.get(req.params.id, ownerId);
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (existing.source === 'builtin') {
      res.status(403).json({ error: 'builtin_immutable' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const validation = validateUpdate(body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    try {
      const updated = registry.update(req.params.id, ownerId, validation.patch);
      if (!updated) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ item: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'update_failed' });
    }
  });

  router.delete('/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const existing = registry.get(req.params.id, ownerId);
    if (existing?.source === 'builtin') {
      res.status(403).json({ error: 'builtin_immutable' });
      return;
    }
    try {
      const ok = registry.delete(req.params.id, ownerId);
      if (!ok) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'delete_failed' });
    }
  });

  return router;
}

interface CreateValidation {
  ok: true;
  input: {
    name: string;
    description: string;
    avatar?: string;
    model?: string;
    allowedTools?: string[];
    blockedTools?: string[];
    systemPrompt: string;
  };
}
interface ValidationFailure {
  ok: false;
  error: string;
}

function validateCreate(body: Record<string, unknown> | undefined): CreateValidation | ValidationFailure {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };
  const name = stringField(body.name);
  if (!name) return { ok: false, error: 'name_required' };
  const systemPrompt = stringField(body.systemPrompt);
  if (!systemPrompt) return { ok: false, error: 'systemPrompt_required' };

  const out: CreateValidation['input'] = {
    name,
    description: stringField(body.description) ?? '',
    systemPrompt,
  };
  const avatar = stringField(body.avatar);
  if (avatar) out.avatar = avatar;
  const model = stringField(body.model);
  if (model) out.model = model;
  const allowedTools = stringArrayField(body.allowedTools);
  if (allowedTools) out.allowedTools = allowedTools;
  const blockedTools = stringArrayField(body.blockedTools);
  if (blockedTools) out.blockedTools = blockedTools;
  return { ok: true, input: out };
}

interface UpdateValidation {
  ok: true;
  patch: {
    name?: string;
    description?: string;
    avatar?: string | null;
    model?: string | null;
    allowedTools?: string[] | null;
    blockedTools?: string[] | null;
    systemPrompt?: string;
  };
}

function validateUpdate(body: Record<string, unknown> | undefined): UpdateValidation | ValidationFailure {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };
  const patch: UpdateValidation['patch'] = {};
  if ('name' in body) {
    const v = stringField(body.name);
    if (!v) return { ok: false, error: 'name_invalid' };
    patch.name = v;
  }
  if ('description' in body) patch.description = stringField(body.description) ?? '';
  if ('avatar' in body) patch.avatar = stringField(body.avatar) ?? null;
  if ('model' in body) patch.model = stringField(body.model) ?? null;
  if ('allowedTools' in body) patch.allowedTools = stringArrayField(body.allowedTools) ?? null;
  if ('blockedTools' in body) patch.blockedTools = stringArrayField(body.blockedTools) ?? null;
  if ('systemPrompt' in body) {
    const v = stringField(body.systemPrompt);
    if (!v) return { ok: false, error: 'systemPrompt_invalid' };
    patch.systemPrompt = v;
  }
  return { ok: true, patch };
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
