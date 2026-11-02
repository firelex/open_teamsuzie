import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AttemptLimiter, limitAttempts } from './attempt-limiter.js';

function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('AttemptLimiter', () => {
    it('allows up to the per-account limit, then refuses with a retry time', () => {
        const c = clock();
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 100, maxPerAccount: 3, now: c.now });
        for (let i = 0; i < 3; i++) expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(true);
        const refused = limiter.attempt('1.1.1.1', 'a@example.com');
        expect(refused).toEqual({ allowed: false, retryAfterSeconds: 60 });
    });

    it('counts an account across addresses, ignoring case and spaces', () => {
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 100, maxPerAccount: 2 });
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(true);
        expect(limiter.attempt('2.2.2.2', ' A@Example.com ').allowed).toBe(true);
        expect(limiter.attempt('3.3.3.3', 'a@EXAMPLE.com').allowed).toBe(false);
        // Another account is unaffected.
        expect(limiter.attempt('3.3.3.3', 'b@example.com').allowed).toBe(true);
    });

    it('counts an address across accounts', () => {
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 2, maxPerAccount: 100 });
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(true);
        expect(limiter.attempt('1.1.1.1', 'b@example.com').allowed).toBe(true);
        expect(limiter.attempt('1.1.1.1', 'c@example.com').allowed).toBe(false);
        expect(limiter.attempt('1.1.1.1').allowed).toBe(false);
        expect(limiter.attempt('9.9.9.9', 'c@example.com').allowed).toBe(true);
    });

    it('opens again once the window has passed', () => {
        const c = clock();
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 1, maxPerAccount: 1, now: c.now });
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(true);
        c.advance(30_000);
        expect(limiter.attempt('1.1.1.1', 'a@example.com')).toEqual({ allowed: false, retryAfterSeconds: 30 });
        c.advance(30_000);
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(true);
    });

    it('gives a released (successful) attempt back, once', () => {
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 2, maxPerAccount: 2 });
        for (let i = 0; i < 10; i++) {
            const r = limiter.attempt('1.1.1.1', 'a@example.com');
            expect(r.allowed).toBe(true);
            if (r.allowed) { r.release(); r.release(); }
        }
        const first = limiter.attempt('1.1.1.1', 'a@example.com');
        const second = limiter.attempt('1.1.1.1', 'a@example.com');
        expect(first.allowed && second.allowed).toBe(true);
        // A double release of an earlier attempt must not have pushed the count below what was really used.
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(false);
    });

    it('does not give a release back to a later window', () => {
        const c = clock();
        const limiter = new AttemptLimiter({ windowMs: 1_000, maxPerIp: 1, maxPerAccount: 1, now: c.now });
        const old = limiter.attempt('1.1.1.1', 'a@example.com');
        c.advance(1_000);
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(true);
        if (old.allowed) old.release();
        expect(limiter.attempt('1.1.1.1', 'a@example.com').allowed).toBe(false);
    });

    it('keeps no more than maxKeys keys', () => {
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: 1_000_000, maxPerAccount: 1, maxKeys: 100 });
        for (let i = 0; i < 1_000; i++) limiter.attempt('1.1.1.1', `user${i}@example.com`);
        expect(limiter.size).toBeLessThanOrEqual(100);
    });
});

describe('limitAttempts middleware', () => {
    const servers: Server[] = [];
    afterEach(() => {
        for (const s of servers.splice(0)) s.close();
    });

    async function start(releaseOnSuccess: boolean, max = 3) {
        const limiter = new AttemptLimiter({ windowMs: 60_000, maxPerIp: max, maxPerAccount: max });
        const app = express();
        app.use(express.json());
        app.post('/login', limitAttempts(limiter, { releaseOnSuccess }), (req, res) => {
            if (req.body.password === 'right') res.status(200).json({ ok: true });
            else res.status(401).json({ ok: false });
        });
        const server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        servers.push(server);
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/login`;
        return (email: string, password: string) => fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
    }

    it('answers 429 with Retry-After once failed attempts reach the limit', async () => {
        const post = await start(true);
        for (let i = 0; i < 3; i++) expect((await post('a@example.com', 'wrong')).status).toBe(401);
        const refused = await post('a@example.com', 'right');
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('does not count successful sign-ins when releaseOnSuccess is set', async () => {
        const post = await start(true);
        for (let i = 0; i < 6; i++) expect((await post('a@example.com', 'right')).status).toBe(200);
    });

    it('counts every attempt, successful or not, without releaseOnSuccess', async () => {
        const post = await start(false);
        for (let i = 0; i < 3; i++) expect((await post(`new${i}@example.com`, 'right')).status).toBe(200);
        expect((await post('another@example.com', 'right')).status).toBe(429);
    });

    it('holds a burst of parallel guesses to the limit', async () => {
        const post = await start(true, 5);
        const statuses = (await Promise.all(Array.from({ length: 20 }, () => post('a@example.com', 'wrong'))))
            .map((r) => r.status);
        expect(statuses.filter((s) => s === 401)).toHaveLength(5);
        expect(statuses.filter((s) => s === 429)).toHaveLength(15);
    });
});
