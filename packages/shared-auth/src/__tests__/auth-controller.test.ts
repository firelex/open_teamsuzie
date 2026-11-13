import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import AuthController from '../controllers/auth.js';
import { SessionTracker, type SetStore } from '../services/session-tracker.js';
import type { SharedAuthConfig } from '../types.js';
import type { RegistrationPolicy } from '../utils/registration.js';

// The controller's handlers are driven directly with fake requests and a fake user service, so these tests need no
// database or Redis.

type FakeUser = { id: string; email: string; name: string; role: 'admin' | 'user'; is_active: boolean };

const ADMIN: FakeUser = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin', is_active: true };
const ALICE: FakeUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', role: 'user', is_active: true };
const BOB: FakeUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', role: 'user', is_active: true };
const USERS = [ADMIN, ALICE, BOB];

function baseConfig(registration?: RegistrationPolicy): SharedAuthConfig {
    return {
        node_env: 'test',
        redis: { uri: 'redis://unused', key_prefix: 'test' },
        postgres: { uri: 'postgres://unused' },
        cookie: { name: 'sid', secret: 'test-secret' },
        csrf: { cookie_name: 'csrf' },
        default_user_id: '00000000-0000-0000-0000-000000000000',
        ...(registration ? { registration } : {}),
    };
}

function fakeUserService() {
    return {
        findById: vi.fn(async (id: string) => USERS.find((u) => u.id === id) ?? null),
        findByEmail: vi.fn(async (email: string) => USERS.find((u) => u.email === email) ?? null),
        findAll: vi.fn(async () => ({ users: [ALICE, BOB].map(({ id, name, role }) => ({ id, name, role })) })),
        authenticateAccessToken: vi.fn(async (token: string) =>
            token === 'tsu_admin_token' ? { user: ADMIN, accessToken: { id: 't-1' } } : null),
        authenticate: vi.fn(async (email: string, _password: string) => USERS.find((u) => u.email === email) ?? null),
        create: vi.fn(async (email: string, _password: string, name: string) =>
            ({ id: 'u-new', email, name, role: 'user' as const })),
        createAccessToken: vi.fn(),
    };
}

// A minimal in-memory stand-in for the Redis set commands SessionTracker needs, so tests never open a real
// Redis connection. Copied from session-tracker.test.ts's fakeRedis.
function fakeRedisForTests(): SetStore & { data: Map<string, Set<string> | string> } {
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

function makeController(registration?: RegistrationPolicy) {
    const controller = new AuthController(baseConfig(registration));
    const users = fakeUserService();
    (controller as unknown as { userService: unknown }).userService = users;
    // Creating a workspace touches the organisation tables; not what these tests are about.
    (controller as unknown as { ensureHumanWorkspace: () => Promise<void> }).ensureHumanWorkspace = async () => {};
    const redis = fakeRedisForTests();
    controller.setSessionTracker(new SessionTracker(redis, 'test', 3600));
    return { controller, users, redis };
}

function fakeReq(opts: { userId?: string; bearer?: string; body?: unknown; params?: Record<string, string> } = {}): Request {
    const session: Record<string, unknown> = { userId: opts.userId };
    session.regenerate = (cb: (err?: unknown) => void) => cb();
    return {
        session,
        sessionID: 'sid-1',
        headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
        body: opts.body ?? {},
        params: opts.params ?? {},
    } as unknown as Request;
}

function fakeRes() {
    const out = { statusCode: 0, body: undefined as unknown };
    const res = {
        status(code: number) { out.statusCode = code; return res; },
        json(body: unknown) { out.body = body; return res; },
    };
    return { res: res as unknown as Response, out };
}

async function call(handler: (req: Request, res: Response) => Promise<void>, req: Request) {
    const { res, out } = fakeRes();
    await handler(req, res);
    // register answers from inside session.regenerate's callback; let it settle.
    await new Promise((r) => setImmediate(r));
    return out;
}

const NEW_ACCOUNT = { email: 'new@example.com', password: 'a-long-password', name: 'New Person' };

describe('register', () => {
    it('is refused with 403 when no policy is configured (closed by default)', async () => {
        const { controller, users } = makeController();
        const out = await call(controller.register, fakeReq({ body: NEW_ACCOUNT }));
        expect(out.statusCode).toBe(403);
        expect(users.create).not.toHaveBeenCalled();
    });

    it('is refused with 403 when closed', async () => {
        const { controller, users } = makeController({ mode: 'closed' });
        const out = await call(controller.register, fakeReq({ body: NEW_ACCOUNT }));
        expect(out.statusCode).toBe(403);
        expect(out.body).toEqual({ error: 'registration_not_allowed', message: expect.stringMatching(/closed/i) });
        expect(users.create).not.toHaveBeenCalled();
    });

    it('creates the account when open', async () => {
        const { controller, users } = makeController({ mode: 'open' });
        const out = await call(controller.register, fakeReq({ body: NEW_ACCOUNT }));
        expect(out.statusCode).toBe(201);
        expect(users.create).toHaveBeenCalledWith(NEW_ACCOUNT.email, NEW_ACCOUNT.password, NEW_ACCOUNT.name);
    });

    it('with domains, creates accounts only at the listed domains', async () => {
        const { controller, users } = makeController({ mode: 'domains', domains: ['example.com'] });
        const allowed = await call(controller.register, fakeReq({ body: NEW_ACCOUNT }));
        expect(allowed.statusCode).toBe(201);

        const refused = await call(controller.register, fakeReq({ body: { ...NEW_ACCOUNT, email: 'new@elsewhere.test' } }));
        expect(refused.statusCode).toBe(403);
        expect(users.create).toHaveBeenCalledTimes(1);
    });

    it('refuses non-string fields with 400 when open', async () => {
        const { controller, users } = makeController({ mode: 'open' });
        const out = await call(controller.register, fakeReq({ body: { ...NEW_ACCOUNT, password: { $gt: '' } } }));
        expect(out.statusCode).toBe(400);
        expect(users.create).not.toHaveBeenCalled();
    });
});

describe('GET /users', () => {
    it('answers 401 without a session or token, and lists nothing', async () => {
        const { controller, users } = makeController();
        const out = await call(controller.listUsers, fakeReq());
        expect(out.statusCode).toBe(401);
        expect(users.findAll).not.toHaveBeenCalled();
    });

    it('answers 401 for a bearer token that does not verify', async () => {
        const { controller, users } = makeController();
        const out = await call(controller.listUsers, fakeReq({ bearer: 'tsu_forged' }));
        expect(out.statusCode).toBe(401);
        expect(users.findAll).not.toHaveBeenCalled();
    });

    it('answers 403 for a signed-in user who is not an admin', async () => {
        const { controller, users } = makeController();
        const out = await call(controller.listUsers, fakeReq({ userId: ALICE.id }));
        expect(out.statusCode).toBe(403);
        expect(users.findAll).not.toHaveBeenCalled();
    });

    it('answers 401 for a session whose user no longer exists', async () => {
        const { controller } = makeController();
        const out = await call(controller.listUsers, fakeReq({ userId: 'u-deleted' }));
        expect(out.statusCode).toBe(401);
    });

    it('lists users for an admin, by session or by bearer token', async () => {
        const { controller } = makeController();
        const bySession = await call(controller.listUsers, fakeReq({ userId: ADMIN.id }));
        expect(bySession.statusCode).toBe(200);
        expect(bySession.body).toEqual({ users: expect.arrayContaining([expect.objectContaining({ id: ALICE.id })]) });

        const byToken = await call(controller.listUsers, fakeReq({ bearer: 'tsu_admin_token' }));
        expect(byToken.statusCode).toBe(200);
    });
});

describe('GET /users/by-email/:email', () => {
    const lookup = (email: string, who: { userId?: string; bearer?: string } = {}) =>
        fakeReq({ ...who, params: { email } });

    it('answers 401 without a session or token, whether or not the address exists', async () => {
        const { controller, users } = makeController();
        expect((await call(controller.lookupByEmail, lookup(BOB.email))).statusCode).toBe(401);
        expect((await call(controller.lookupByEmail, lookup('nobody@example.com'))).statusCode).toBe(401);
        expect(users.findByEmail).not.toHaveBeenCalled();
    });

    it("answers 403 for another user's address, whether or not it exists", async () => {
        const { controller, users } = makeController();
        expect((await call(controller.lookupByEmail, lookup(BOB.email, { userId: ALICE.id }))).statusCode).toBe(403);
        expect((await call(controller.lookupByEmail, lookup('nobody@example.com', { userId: ALICE.id }))).statusCode).toBe(403);
        expect(users.findByEmail).not.toHaveBeenCalled();
    });

    it('lets a user look up their own record', async () => {
        const { controller } = makeController();
        const out = await call(controller.lookupByEmail, lookup(ALICE.email, { userId: ALICE.id }));
        expect(out.statusCode).toBe(200);
        expect(out.body).toEqual({ user: ALICE });
    });

    it('lets an admin look up anyone, and says 404 for an unknown address', async () => {
        const { controller } = makeController();
        const found = await call(controller.lookupByEmail, lookup(BOB.email, { userId: ADMIN.id }));
        expect(found.statusCode).toBe(200);
        expect(found.body).toEqual({ user: BOB });

        const missing = await call(controller.lookupByEmail, lookup('nobody@example.com', { bearer: 'tsu_admin_token' }));
        expect(missing.statusCode).toBe(404);
    });
});

describe('login', () => {
    it('tracks the new session so it can be ended later', async () => {
        const { controller, redis } = makeController();
        const out = await call(controller.login, fakeReq({ body: { email: 'alice@example.com', password: 'right' } }));
        expect(out.statusCode).toBe(200);
        expect(await redis.smembers('test:user-sessions:u-alice')).toEqual(['sid-1']);
    });

    it('marks the session as tracked, so apps can tell it apart from sessions made before tracking existed', async () => {
        const { controller } = makeController();
        const req = fakeReq({ body: { email: 'alice@example.com', password: 'right' } });
        await call(controller.login, req);
        expect((req.session as unknown as Record<string, unknown>).trackedForSignOut).toBe(true);
    });

    it('does not mark the session when tracking fails', async () => {
        const { controller, redis } = makeController();
        redis.sadd = async () => { throw new Error('redis down'); };
        const req = fakeReq({ body: { email: 'alice@example.com', password: 'right' } });
        const out = await call(controller.login, req);
        expect(out.statusCode).toBe(500);
        expect((req.session as unknown as Record<string, unknown>).trackedForSignOut).toBeUndefined();
    });
});

describe('register marks the session', () => {
    it('tracks and marks the new session', async () => {
        const { controller, redis } = makeController({ mode: 'open' });
        const req = fakeReq({ body: NEW_ACCOUNT });
        await call(controller.register, req);
        expect(await redis.smembers('test:user-sessions:u-new')).toEqual(['sid-1']);
        expect((req.session as unknown as Record<string, unknown>).trackedForSignOut).toBe(true);
    });
});

describe('deactivated accounts', () => {
    it('login answers 403 with the deactivation message', async () => {
        const { controller, users } = makeController();
        (users as any).authenticate = vi.fn(async () => {
            throw Object.assign(new Error('This account has been deactivated'), { code: 403 });
        });
        const out = await call(controller.login, fakeReq({ body: { email: 'alice@example.com', password: 'x' } }));
        expect(out.statusCode).toBe(403);
        expect(out.body).toEqual({ error: 'account_deactivated', message: 'This account has been deactivated' });
    });

    it('an existing session of a deactivated user counts as signed out', async () => {
        const { controller, users } = makeController();
        users.findById.mockResolvedValueOnce({ ...ALICE, is_active: false } as any);
        const out = await call(controller.me, fakeReq({ userId: ALICE.id }));
        expect(out.statusCode).toBe(401);
    });
});
