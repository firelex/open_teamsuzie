import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import AuthController from '../controllers/auth.js';
import { SessionTracker, type SetStore } from '../services/session-tracker.js';
import type { SharedAuthConfig } from '../types.js';
import type { RegistrationPolicy } from '../utils/registration.js';

// Every 4xx response from AuthController must carry a stable, machine-readable `error` code next to the existing
// English `message`, so a client (the Suzie Law sign-in page, translated into English/German/French) can pick the
// right translated string by code instead of matching on the English text. The English `message` must stay exactly
// as it was, since other apps still read it directly.
//
// Same controller-with-fakes pattern as auth-controller.test.ts: no database or Redis.

type FakeUser = { id: string; email: string; name: string; role: 'admin' | 'user'; is_active: boolean };

const ADMIN: FakeUser = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin', is_active: true };
const ALICE: FakeUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', role: 'user', is_active: true };
const USERS = [ADMIN, ALICE];

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
        findAll: vi.fn(async () => ({ users: [] })),
        authenticateAccessToken: vi.fn(async () => null),
        authenticate: vi.fn(async (email: string, _password: string) => USERS.find((u) => u.email === email) ?? null),
        create: vi.fn(async (email: string, _password: string, name: string) =>
            ({ id: 'u-new', email, name, role: 'user' as const })),
        createAccessToken: vi.fn(),
        listAccessTokens: vi.fn(async () => []),
        revokeAccessToken: vi.fn(async () => false),
    };
}

function fakeRedisForTests(): SetStore & { data: Map<string, Set<string> | string> } {
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

function makeController(registration?: RegistrationPolicy) {
    const controller = new AuthController(baseConfig(registration));
    const users = fakeUserService();
    (controller as unknown as { userService: unknown }).userService = users;
    (controller as unknown as { ensureHumanWorkspace: () => Promise<void> }).ensureHumanWorkspace = async () => {};
    const redis = fakeRedisForTests();
    controller.setSessionTracker(new SessionTracker(redis, 'test'));
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
    // register/login answer from inside session.regenerate's callback; let it settle.
    await new Promise((r) => setImmediate(r));
    return out;
}

describe('stable error codes on 4xx auth responses', () => {
    it('login with an empty body answers 400 missing_credentials', async () => {
        const { controller } = makeController();
        const out = await call(controller.login, fakeReq({ body: {} }));
        expect(out.statusCode).toBe(400);
        expect(out.body).toEqual({ error: 'missing_credentials', message: 'Email and password are required' });
    });

    it('login with a wrong password answers 401 invalid_credentials', async () => {
        const { controller } = makeController();
        const out = await call(controller.login, fakeReq({ body: { email: 'nobody@example.com', password: 'x' } }));
        expect(out.statusCode).toBe(401);
        expect(out.body).toEqual({ error: 'invalid_credentials', message: 'Invalid email or password' });
    });

    it('login for a deactivated account answers 403 account_deactivated', async () => {
        const { controller, users } = makeController();
        (users as any).authenticate = vi.fn(async () => {
            throw Object.assign(new Error('This account has been deactivated'), { code: 403 });
        });
        const out = await call(controller.login, fakeReq({ body: { email: 'alice@example.com', password: 'x' } }));
        expect(out.statusCode).toBe(403);
        expect(out.body).toEqual({ error: 'account_deactivated', message: 'This account has been deactivated' });
    });

    it('/me without a session answers 401 not_authenticated', async () => {
        const { controller } = makeController();
        const out = await call(controller.me, fakeReq());
        expect(out.statusCode).toBe(401);
        expect(out.body).toEqual({ error: 'not_authenticated', message: 'Not authenticated' });
    });

    it('/introspect without a session answers 401 not_authenticated', async () => {
        const { controller } = makeController();
        const out = await call(controller.introspect, fakeReq());
        expect(out.statusCode).toBe(401);
        expect(out.body).toEqual({ authenticated: false, error: 'not_authenticated', message: 'Not authenticated' });
    });

    it('registration refused by a closed policy answers 403 registration_not_allowed', async () => {
        const { controller, users } = makeController({ mode: 'closed' });
        const out = await call(controller.register, fakeReq({
            body: { email: 'new@example.com', password: 'a-long-password', name: 'New Person' },
        }));
        expect(out.statusCode).toBe(403);
        expect(out.body).toEqual({
            error: 'registration_not_allowed',
            message: expect.stringMatching(/closed/i),
        });
        expect(users.create).not.toHaveBeenCalled();
    });

    it('registration with missing fields answers 400 missing_registration_fields', async () => {
        const { controller } = makeController({ mode: 'open' });
        const out = await call(controller.register, fakeReq({ body: { email: 'new@example.com' } }));
        expect(out.statusCode).toBe(400);
        expect(out.body).toEqual({ error: 'missing_registration_fields', message: 'Email, password, and name are required' });
    });

    it('registration for an email already in use answers 400 email_already_registered', async () => {
        const { controller, users } = makeController({ mode: 'open' });
        (users as any).create = vi.fn(async () => {
            throw Object.assign(new Error('User with this email already exists'), { code: 400 });
        });
        const out = await call(controller.register, fakeReq({
            body: { email: 'alice@example.com', password: 'a-long-password', name: 'Alice' },
        }));
        expect(out.statusCode).toBe(400);
        expect(out.body).toEqual({ error: 'email_already_registered', message: 'User with this email already exists' });
    });

    it('revoking a token without an id answers 400 token_id_required', async () => {
        const { controller } = makeController();
        const out = await call(controller.revokeAccessToken, fakeReq({ userId: ALICE.id, params: { id: '' } }));
        expect(out.statusCode).toBe(400);
        expect(out.body).toEqual({ error: 'token_id_required', message: 'Token id is required' });
    });

    it('revoking an unknown token id answers 404 token_not_found', async () => {
        const { controller, users } = makeController();
        users.revokeAccessToken.mockResolvedValueOnce(false);
        const out = await call(controller.revokeAccessToken, fakeReq({ userId: ALICE.id, params: { id: 't-missing' } }));
        expect(out.statusCode).toBe(404);
        expect(out.body).toEqual({ error: 'token_not_found', message: 'Token not found' });
    });

    it("looking up another user's address answers 403 forbidden", async () => {
        const { controller } = makeController();
        const out = await call(controller.lookupByEmail, fakeReq({ userId: ALICE.id, params: { email: ADMIN.email } }));
        expect(out.statusCode).toBe(403);
        expect(out.body).toEqual({ error: 'forbidden', message: 'Forbidden' });
    });

    it('looking up with no email parameter answers 400 email_required', async () => {
        const { controller } = makeController();
        const out = await call(controller.lookupByEmail, fakeReq({ userId: ADMIN.id, params: {} }));
        expect(out.statusCode).toBe(400);
        expect(out.body).toEqual({ error: 'email_required', message: 'Email parameter is required' });
    });

    it('looking up an unknown address as admin answers 404 user_not_found', async () => {
        const { controller } = makeController();
        const out = await call(controller.lookupByEmail, fakeReq({ userId: ADMIN.id, params: { email: 'nobody@example.com' } }));
        expect(out.statusCode).toBe(404);
        expect(out.body).toEqual({ error: 'user_not_found', message: 'User not found' });
    });
});
