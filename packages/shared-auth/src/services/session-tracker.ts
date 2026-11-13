import type { SharedAuthConfig } from '../types.js';

/** The few Redis commands the tracker needs; an ioredis client satisfies it. */
export interface SetStore {
    sadd(key: string, member: string): Promise<unknown>;
    srem(key: string, member: string): Promise<unknown>;
    smembers(key: string): Promise<string[]>;
    del(...keys: string[]): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long a user's set of tracked sessions is kept after their latest sign-in, in seconds: the session cookie's
 * `maxAge` from the config when it is set (no session outlives its cookie), otherwise 30 days. Without a `maxAge`
 * the cookie lasts until the browser closes and the session store keeps the session for a day, so 30 days is
 * comfortably longer than any such session.
 */
export function sessionTrackerTtlSeconds(config: Pick<SharedAuthConfig, 'cookie'>): number {
    const maxAge = config.cookie.maxAge;
    return maxAge !== undefined ? Math.ceil(maxAge / 1000) : THIRTY_DAYS_SECONDS;
}

/**
 * Remembers which sessions belong to which user, so an admin's change (role, deactivation, removal, password reset)
 * can sign that person out everywhere. Session keys follow SessionService: `<prefix>:session:<sid>`.
 *
 * `ttlSeconds` is required: every `track` resets the expiry of that user's set to it, so the set of someone who
 * stops signing in does not stay in Redis forever. Callers that have the shared-auth config pass
 * `sessionTrackerTtlSeconds(config)`; the tracker itself picks no default.
 */
export class SessionTracker {
    constructor(
        private readonly redis: SetStore,
        private readonly keyPrefix: string,
        private readonly ttlSeconds: number,
    ) {
        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
            throw new Error(`SessionTracker: ttlSeconds must be a positive whole number of seconds, got ${ttlSeconds}`);
        }
    }

    private setKey(userId: string): string {
        return `${this.keyPrefix}:user-sessions:${userId}`;
    }

    async track(userId: string, sessionId: string): Promise<void> {
        await this.redis.sadd(this.setKey(userId), sessionId);
        await this.redis.expire(this.setKey(userId), this.ttlSeconds);
    }

    async untrack(userId: string, sessionId: string): Promise<void> {
        await this.redis.srem(this.setKey(userId), sessionId);
    }

    async endSessionsFor(userId: string): Promise<number> {
        const ids = await this.redis.smembers(this.setKey(userId));
        if (ids.length > 0) await this.redis.del(...ids.map((sid) => `${this.keyPrefix}:session:${sid}`));
        await this.redis.del(this.setKey(userId));
        return ids.length;
    }
}
