import { describe, expect, it } from 'vitest';
import { VolumeLimiter } from './limiter.js';

function fakeClock() {
    let now = 1_000_000;
    const slept: number[] = [];
    return {
        now: () => now,
        sleep: async (ms: number) => { slept.push(ms); now += ms; },
        advance: (ms: number) => { now += ms; },
        slept,
    };
}

describe('VolumeLimiter', () => {
    it('lets opens through up to the per-minute limit, then waits for the oldest to age out', async () => {
        const clock = fakeClock();
        const limiter = new VolumeLimiter({ opensPerMinute: 2, opensPerHour: 100, minSecondsBetweenSends: 30 }, clock.now, clock.sleep);
        await limiter.acquire('open');
        clock.advance(1000);
        await limiter.acquire('open');
        expect(clock.slept).toEqual([]);
        await limiter.acquire('open');
        expect(clock.slept).toEqual([59_000]);
    });

    it('applies the per-hour limit', async () => {
        const clock = fakeClock();
        const limiter = new VolumeLimiter({ opensPerMinute: 100, opensPerHour: 2, minSecondsBetweenSends: 30 }, clock.now, clock.sleep);
        await limiter.acquire('open');
        await limiter.acquire('open');
        await limiter.acquire('open');
        expect(clock.slept).toEqual([3_600_000]);
    });

    it('spaces sends', async () => {
        const clock = fakeClock();
        const limiter = new VolumeLimiter({ opensPerMinute: 10, opensPerHour: 100, minSecondsBetweenSends: 30 }, clock.now, clock.sleep);
        await limiter.acquire('send');
        clock.advance(10_000);
        await limiter.acquire('send');
        expect(clock.slept).toEqual([20_000]);
    });

    it('rejects non-positive limits', () => {
        expect(() => new VolumeLimiter({ opensPerMinute: 0, opensPerHour: 1, minSecondsBetweenSends: 1 })).toThrow(/opensPerMinute/);
    });
});
