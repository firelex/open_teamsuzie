import { Router, type Request, type Response } from 'express';

import type { MatterMetadataStore } from './metadata-store.js';

export interface CreateMatterMetadataRouterOptions {
    metadata: MatterMetadataStore;
}

/**
 * REST endpoints for a single matter's metadata row. Mount under
 * `/api/matters/:matterId/metadata` (so the parent
 * `requireMatterAccess` middleware already gates the membership
 * check):
 *
 *   GET  /  — returns the stored metadata, or null when no row exists.
 *   PUT  /  — replaces type_id + custom_fields. Body shape:
 *               { typeId?: string | null, customFields?: object }
 *             A missing customFields defaults to {}. The router does
 *             NOT validate against the manifest's field configuration —
 *             that's a host responsibility (agent-runtime calls
 *             `validateCustomFieldValues` before invoking PUT).
 *
 * Express 5 doesn't merge parent params by default; the agent-runtime
 * mount stashes `_matterId` on the request before this router runs
 * (same pattern as the chats / reviews mounts).
 */
export function createMatterMetadataRouter(
    opts: CreateMatterMetadataRouterOptions,
): Router {
    const { metadata } = opts;
    const router: Router = Router({ mergeParams: true });

    router.get('/', (req: Request, res: Response) => {
        const matterId = resolveMatterId(req);
        const item = metadata.get(matterId);
        res.json({ item });
    });

    router.put('/', (req: Request, res: Response) => {
        const matterId = resolveMatterId(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const typeId =
            body.typeId === null
                ? null
                : typeof body.typeId === 'string' && body.typeId.trim().length > 0
                  ? body.typeId.trim()
                  : null;
        const customFields =
            body.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)
                ? (body.customFields as Record<string, unknown>)
                : {};
        const item = metadata.upsert({ matterId, typeId, customFields });
        res.status(200).json({ item });
    });

    return router;
}

function resolveMatterId(req: Request): string {
    return (
        ((req as unknown as { _matterId?: string })._matterId ?? '') ||
        String((req.params as { matterId?: string }).matterId ?? '')
    );
}
