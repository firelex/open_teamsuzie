/**
 * Platform Auth Middleware
 *
 * Validates requests from the Team Suzie mothership platform.
 * When a valid platform token is present, creates a virtual session
 * so the request bypasses normal session auth.
 */

import type { Request, Response, NextFunction } from 'express';

export interface PlatformBridgeConfig {
    /** Shared secret token that the mothership sends in X-Platform-Token header. */
    platformToken?: string;
}

export interface VirtualSessionUser {
    email: string;
    name: string;
    role: string;
}

/**
 * Creates middleware that checks for X-Platform-Token header.
 * If present and valid, creates a virtual session from the request context
 * so the request bypasses normal session auth.
 * Falls through to regular auth if no platform token is present.
 */
export function createPlatformRequestMiddleware(config: PlatformBridgeConfig) {
    return function validatePlatformRequest(req: Request, _res: Response, next: NextFunction): void {
        const token = req.headers['x-platform-token'] as string | undefined;

        if (token && config.platformToken && token === config.platformToken) {
            const context = req.body?.context;
            const virtualUser: VirtualSessionUser = {
                email: context?.user_email || 'platform@internal',
                name: context?.user_name || 'Platform User',
                role: context?.user_role || 'user',
            };
            (req as any).session = { user: virtualUser };
            return next();
        }

        return next();
    };
}

/**
 * Creates middleware that *requires* a valid platform token.
 * Used for webhook endpoints that should only accept platform requests.
 */
export function createPlatformTokenGuard(config: PlatformBridgeConfig) {
    return function requirePlatformToken(req: Request, res: Response, next: NextFunction): void {
        if (!config.platformToken) {
            res.status(503).json({ error: 'Platform integration not configured' });
            return;
        }

        const token = req.headers['x-platform-token'] as string | undefined;
        if (!token || token !== config.platformToken) {
            res.status(401).json({ error: 'Invalid platform token' });
            return;
        }

        next();
    };
}
