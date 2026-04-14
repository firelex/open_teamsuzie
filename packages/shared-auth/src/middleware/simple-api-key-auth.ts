import type { Request, Response, NextFunction } from 'express';

export interface SimpleApiKeyAuthOptions {
    /**
     * The expected API key value. If not set, requests are rejected with 503
     * (fail-closed).
     */
    apiKey?: string;

    /**
     * Whether to bypass auth for localhost requests in non-production environments.
     * Defaults to false. Callers must explicitly opt in.
     */
    allowLocalhostBypass?: boolean;

    /**
     * Optional logger. Defaults to console.
     */
    logger?: {
        warn(message: string, ...args: unknown[]): void;
    };
}

/**
 * Simple environment-variable-based API key authentication middleware.
 * Suitable for services that need basic key checking without database lookups.
 *
 * Accepts the key via:
 *   - X-API-Key header
 *   - Authorization: Bearer {key}
 *
 * Features:
 *   - Localhost bypass in non-production environments (configurable)
 *   - Fail-closed when no key is configured (rejects with 503)
 */
export class SimpleApiKeyAuth {
    private readonly apiKey: string | undefined;
    private readonly allowLocalhostBypass: boolean;
    private readonly logger: { warn(message: string, ...args: unknown[]): void };

    constructor(options: SimpleApiKeyAuthOptions = {}) {
        this.apiKey = options.apiKey ?? (process.env.OPENCLAW_API_KEY || process.env.API_KEY);
        this.allowLocalhostBypass = options.allowLocalhostBypass ?? false;
        this.logger = options.logger ?? console;
    }

    /**
     * Check API key for public API endpoints.
     * Allows requests from localhost without API key in non-production mode (if enabled).
     * Requires API key from external IPs.
     */
    checkApiKey = (req: Request, res: Response, next: NextFunction): void => {
        if (this.allowLocalhostBypass && process.env.NODE_ENV !== 'production') {
            const clientIp = req.ip || req.socket.remoteAddress || '';
            const isLocalhost = clientIp === '127.0.0.1' ||
                                clientIp === '::1' ||
                                clientIp === '::ffff:127.0.0.1';

            if (isLocalhost) {
                next();
                return;
            }
        }

        const providedKey = req.headers['x-api-key'] as string ||
                            req.headers['authorization']?.replace('Bearer ', '');

        if (!this.apiKey) {
            this.logger.warn('API: No API key configured in environment — rejecting request (fail-closed)');
            res.status(503).json({
                error: 'Service Unavailable',
                message: 'API key not configured on server'
            });
            return;
        }

        if (!providedKey) {
            const clientIp = req.ip || req.socket.remoteAddress || '';
            this.logger.warn(`API: Missing API key from external IP ${clientIp}`);
            res.status(401).json({
                error: 'Unauthorized',
                message: 'API key required. Set X-API-Key header or Authorization: Bearer <key>'
            });
            return;
        }

        if (providedKey !== this.apiKey) {
            const clientIp = req.ip || req.socket.remoteAddress || '';
            this.logger.warn(`API: Invalid API key from external IP ${clientIp}`);
            res.status(403).json({
                error: 'Forbidden',
                message: 'Invalid API key'
            });
            return;
        }

        next();
    };
}
