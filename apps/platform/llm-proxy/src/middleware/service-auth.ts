import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Service-to-service auth for the LLM proxy's /admin/* routes.
 *
 * The admin service uses these endpoints to hot-reload provider keys, org
 * key overrides, and per-agent condensation configs. They MUST require
 * INTERNAL_SERVICE_KEY — anyone who can reach the proxy could otherwise
 * replace provider keys, repoint orgs at attacker-controlled keys, or
 * silently change condensation models.
 *
 * The proxy intentionally does not depend on @teamsuzie/shared-auth, so this
 * is a local mirror of `createServiceAuth` from shared-auth. Accepts the key
 * via `Authorization: Bearer <key>` or `X-Service-Key: <key>`. Uses
 * timing-safe comparison.
 */
export function serviceAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.INTERNAL_SERVICE_KEY;
    if (!expected) {
        res.status(503).json({ error: 'Service Unavailable', message: 'INTERNAL_SERVICE_KEY not configured' });
        return;
    }

    const authHeader = req.headers.authorization;
    const headerKey = req.headers['x-service-key'];
    const provided = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : (Array.isArray(headerKey) ? headerKey[0] : headerKey);

    if (!provided || typeof provided !== 'string' || provided.length !== expected.length) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid service key' });
        return;
    }

    let ok = false;
    try {
        ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch {
        ok = false;
    }

    if (!ok) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid service key' });
        return;
    }

    next();
}
