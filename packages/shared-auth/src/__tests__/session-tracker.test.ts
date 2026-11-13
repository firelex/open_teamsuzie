import { describe, expect, it } from 'vitest';
import { SessionTracker, sessionTrackerTtlSeconds, type SetStore } from '../services/session-tracker.js';

function fakeRedis(): SetStore & { data: Map<string, Set<string> | string> } {
    const data = new Map<string, Set<string> | string>();
    const set = (k: string) => (data.get(k) as Set<string>) ?? (data.set(k, new Set()).get(k) as Set<string>);
    return {
        data,
        async sadd(k, m) { set(k).add(m); return 1; },
        async srem(k, m) { set(k).delete(m); return 1; },
        async smembers(k) { return [...((data.get(k) as Set<string>) ?? [])]; },
        async del(...ks) { ks.forEach((k) => data.delete(k)); return ks.length; },
        async expire() { return 1; },
    };
}

describe('SessionTracker', () => {
    it('ends every tracked session of one user and leaves others alone', async () => {
        const redis = fakeRedis();
        redis.data.set('t:session:s1', '{}');
        redis.data.set('t:session:s2', '{}');
        redis.data.set('t:session:s3', '{}');
        const tracker = new SessionTracker(redis, 't', 3600);
        await tracker.track('alice', 's1');
        await tracker.track('alice', 's2');
        await tracker.track('bob', 's3');

        expect(await tracker.endSessionsFor('alice')).toBe(2);
        expect(redis.data.has('t:session:s1')).toBe(false);
        expect(redis.data.has('t:session:s2')).toBe(false);
        expect(redis.data.has('t:session:s3')).toBe(true);
        expect(await redis.smembers('t:user-sessions:alice')).toEqual([]);
    });

    it('forgets a session on untrack', async () => {
        const redis = fakeRedis();
        const tracker = new SessionTracker(redis, 't', 3600);
        await tracker.track('alice', 's1');
        await tracker.untrack('alice', 's1');
        expect(await tracker.endSessionsFor('alice')).toBe(0);
    });

    it('sets the expiry of the user\'s set on every track', async () => {
        const redis = fakeRedis();
        const expiries: Array<[string, number]> = [];
        redis.expire = async (k, sec) => { expiries.push([k, sec]); return 1; };
        const tracker = new SessionTracker(redis, 't', 604800);
        await tracker.track('alice', 's1');
        await tracker.track('alice', 's2');
        expect(expiries).toEqual([['t:user-sessions:alice', 604800], ['t:user-sessions:alice', 604800]]);
    });

    it('refuses a missing or non-positive expiry', () => {
        expect(() => new SessionTracker(fakeRedis(), 't', 0)).toThrow(/ttlSeconds/);
        expect(() => new SessionTracker(fakeRedis(), 't', undefined as unknown as number)).toThrow(/ttlSeconds/);
    });

    it('takes the expiry from the cookie maxAge, or 30 days when the config sets none', () => {
        expect(sessionTrackerTtlSeconds({ cookie: { name: 'c', secret: 's', maxAge: 7 * 24 * 3600 * 1000 } })).toBe(7 * 24 * 3600);
        expect(sessionTrackerTtlSeconds({ cookie: { name: 'c', secret: 's' } })).toBe(30 * 24 * 3600);
    });

    it('lets a Redis failure through', async () => {
        const redis = fakeRedis();
        redis.smembers = async () => { throw new Error('redis down'); };
        await expect(new SessionTracker(redis, 't', 3600).endSessionsFor('alice')).rejects.toThrow('redis down');
    });
});
