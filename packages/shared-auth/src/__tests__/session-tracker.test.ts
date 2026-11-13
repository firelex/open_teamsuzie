import { describe, expect, it } from 'vitest';
import { SessionTracker, type SetStore } from '../services/session-tracker.js';

function fakeRedis(): SetStore & { data: Map<string, Set<string> | string> } {
    const data = new Map<string, Set<string> | string>();
    const set = (k: string) => (data.get(k) as Set<string>) ?? (data.set(k, new Set()).get(k) as Set<string>);
    return {
        data,
        async sadd(k, m) { set(k).add(m); return 1; },
        async srem(k, m) { set(k).delete(m); return 1; },
        async smembers(k) { return [...((data.get(k) as Set<string>) ?? [])]; },
        async del(...ks) { ks.forEach((k) => data.delete(k)); return ks.length; },
    };
}

describe('SessionTracker', () => {
    it('ends every tracked session of one user and leaves others alone', async () => {
        const redis = fakeRedis();
        redis.data.set('t:session:s1', '{}');
        redis.data.set('t:session:s2', '{}');
        redis.data.set('t:session:s3', '{}');
        const tracker = new SessionTracker(redis, 't');
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
        const tracker = new SessionTracker(redis, 't');
        await tracker.track('alice', 's1');
        await tracker.untrack('alice', 's1');
        expect(await tracker.endSessionsFor('alice')).toBe(0);
    });

    it('lets a Redis failure through', async () => {
        const redis = fakeRedis();
        redis.smembers = async () => { throw new Error('redis down'); };
        await expect(new SessionTracker(redis, 't').endSessionsFor('alice')).rejects.toThrow('redis down');
    });
});
