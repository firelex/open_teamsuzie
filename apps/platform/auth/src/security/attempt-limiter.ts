import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory limit on sign-in and registration attempts, per client address and per account (email), over a fixed
 * window. Each attempt counts against both buckets as it starts, so a burst of parallel guesses cannot slip past the
 * limit; an attempt that succeeds is given back, so people signing in normally are not counted.
 *
 * The counts live in this process only: with several instances each keeps its own, and a restart clears them.
 */
export interface AttemptLimiterOptions {
    windowMs: number;
    maxPerIp: number;
    maxPerAccount: number;
    /** Upper bound on tracked keys, so a flood of made-up emails cannot grow memory without limit. */
    maxKeys?: number;
    now?: () => number;
}

export type AttemptResult =
    | { allowed: true; release: () => void }
    | { allowed: false; retryAfterSeconds: number };

interface Bucket { count: number; resetAt: number }

const MAX_ACCOUNT_KEY_LENGTH = 320;

export function accountKey(email: unknown): string | undefined {
    if (typeof email !== 'string') return undefined;
    const key = email.trim().toLowerCase().slice(0, MAX_ACCOUNT_KEY_LENGTH);
    return key || undefined;
}

export class AttemptLimiter {
    private readonly buckets = new Map<string, Bucket>();
    private readonly maxKeys: number;
    private readonly now: () => number;

    constructor(private readonly options: AttemptLimiterOptions) {
        this.maxKeys = options.maxKeys ?? 50_000;
        this.now = options.now ?? Date.now;
    }

    /** Count one attempt from `ip` for `account` (an email, if one was given). */
    attempt(ip: string, account?: string): AttemptResult {
        const now = this.now();
        const keys: Array<[string, number]> = [[`ip:${ip}`, this.options.maxPerIp]];
        const normalized = accountKey(account);
        if (normalized) keys.push([`acct:${normalized}`, this.options.maxPerAccount]);

        let retryAfterMs = 0;
        for (const [key, max] of keys) {
            const bucket = this.live(key, now);
            if (bucket && bucket.count >= max) retryAfterMs = Math.max(retryAfterMs, bucket.resetAt - now);
        }
        if (retryAfterMs > 0) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
        }

        const counted: Array<[string, Bucket]> = keys.map(([key]) => {
            let bucket = this.live(key, now);
            if (!bucket) {
                bucket = { count: 0, resetAt: now + this.options.windowMs };
                this.buckets.set(key, bucket);
            }
            bucket.count += 1;
            return [key, bucket];
        });
        this.prune(now);

        let released = false;
        return {
            allowed: true,
            release: () => {
                if (released) return;
                released = true;
                for (const [key, bucket] of counted) {
                    // Only give back to the window the attempt was counted in.
                    if (this.buckets.get(key) === bucket && bucket.count > 0) bucket.count -= 1;
                }
            },
        };
    }

    /** Number of keys being tracked (for tests). */
    get size(): number {
        return this.buckets.size;
    }

    private live(key: string, now: number): Bucket | undefined {
        const bucket = this.buckets.get(key);
        if (bucket && bucket.resetAt <= now) {
            this.buckets.delete(key);
            return undefined;
        }
        return bucket;
    }

    private prune(now: number): void {
        if (this.buckets.size <= this.maxKeys) return;
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now) this.buckets.delete(key);
        }
        // Still too many live keys: drop the oldest (a Map iterates in insertion order).
        for (const key of this.buckets.keys()) {
            if (this.buckets.size <= this.maxKeys) break;
            this.buckets.delete(key);
        }
    }
}

export function clientAddress(req: Request): string {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

export const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again shortly.';

/**
 * Express middleware for the JSON sign-in and registration routes. The account is the `email` in the parsed body, so
 * mount it after the body parsers. With `releaseOnSuccess` (sign-in), a response below 400 gives the attempt back;
 * without it (registration), every attempt counts, so one address cannot create accounts without limit.
 */
export function limitAttempts(limiter: AttemptLimiter, { releaseOnSuccess }: { releaseOnSuccess: boolean }) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = limiter.attempt(clientAddress(req), req.body?.email);
        if (!result.allowed) {
            res.setHeader('Retry-After', String(result.retryAfterSeconds));
            res.status(429).json({ message: TOO_MANY_ATTEMPTS, retry_after_seconds: result.retryAfterSeconds });
            return;
        }
        if (releaseOnSuccess) {
            res.on('finish', () => {
                if (res.statusCode < 400) result.release();
            });
        }
        next();
    };
}
