/** The few Redis set commands the tracker needs; an ioredis client satisfies it. */
export interface SetStore {
    sadd(key: string, member: string): Promise<unknown>;
    srem(key: string, member: string): Promise<unknown>;
    smembers(key: string): Promise<string[]>;
    del(...keys: string[]): Promise<unknown>;
}

/**
 * Remembers which sessions belong to which user, so an admin's change (role, deactivation, removal, password reset)
 * can sign that person out everywhere. Session keys follow SessionService: `<prefix>:session:<sid>`.
 */
export class SessionTracker {
    constructor(private readonly redis: SetStore, private readonly keyPrefix: string) {}

    private setKey(userId: string): string {
        return `${this.keyPrefix}:user-sessions:${userId}`;
    }

    async track(userId: string, sessionId: string): Promise<void> {
        await this.redis.sadd(this.setKey(userId), sessionId);
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
