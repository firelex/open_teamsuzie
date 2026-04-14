import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';

export interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
    keyPrefix?: string;
    skipFailedRequests?: boolean;
    message?: string;
    statusCode?: number;
}

export interface RateLimitOptions {
    auth: RateLimitConfig;
    api: RateLimitConfig;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
    auth: {
        windowMs: 15 * 60 * 1000,
        maxRequests: 5,
        keyPrefix: 'rl:auth:',
        message: 'Too many login attempts, please try again later',
        statusCode: 429
    },
    api: {
        windowMs: 60 * 1000,
        maxRequests: 100,
        keyPrefix: 'rl:api:',
        message: 'Too many requests, please try again later',
        statusCode: 429
    }
};

export default class RateLimitMiddleware {
    private redisClient: Redis;
    private options: RateLimitOptions;

    constructor(redisClient: Redis, options?: Partial<RateLimitOptions>) {
        this.redisClient = redisClient;
        this.options = {
            auth: { ...DEFAULT_OPTIONS.auth, ...options?.auth },
            api: { ...DEFAULT_OPTIONS.api, ...options?.api }
        };
    }

    private getKey(prefix: string, req: Request): string {
        const identifier = req.ip || req.socket.remoteAddress || 'unknown';
        return `${prefix}${identifier}`;
    }

    private async checkLimit(
        req: Request,
        res: Response,
        config: RateLimitConfig
    ): Promise<boolean> {
        const key = this.getKey(config.keyPrefix || 'rl:', req);
        const windowSeconds = Math.ceil(config.windowMs / 1000);

        try {
            const current = await this.redisClient.incr(key);

            if (current === 1) {
                await this.redisClient.expire(key, windowSeconds);
            }

            const ttl = await this.redisClient.ttl(key);

            res.setHeader('X-RateLimit-Limit', config.maxRequests);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - current));
            res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + ttl);

            if (current > config.maxRequests) {
                res.setHeader('Retry-After', ttl);
                res.status(config.statusCode || 429).json({
                    error: 'Too Many Requests',
                    message: config.message || 'Rate limit exceeded'
                });
                return false;
            }

            return true;
        } catch (error) {
            console.error('[RATE_LIMIT] Redis error:', error);
            return true;
        }
    }

    authRateLimit = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        const allowed = await this.checkLimit(req, res, this.options.auth);
        if (allowed) {
            next();
        }
    };

    apiRateLimit = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        const allowed = await this.checkLimit(req, res, this.options.api);
        if (allowed) {
            next();
        }
    };

    customRateLimit(config: RateLimitConfig) {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            const allowed = await this.checkLimit(req, res, config);
            if (allowed) {
                next();
            }
        };
    }

    async resetLimit(req: Request, prefix: string): Promise<void> {
        const key = this.getKey(prefix, req);
        await this.redisClient.del(key);
    }
}
