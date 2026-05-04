import { Router, type Request } from 'express';
import type { PersonaRegistry } from './registry.js';

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
    res.json({ personas: registry.listVisibleTo(ownerId) });
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
    res.json({ persona });
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
      res.status(201).json({ persona });
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
      res.json({ persona: updated });
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
