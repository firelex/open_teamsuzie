import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import AuthController from '../controllers/auth.js';
import type { SharedAuthConfig } from '../types.js';
import type { RegistrationPolicy } from '../utils/registration.js';

// The controller's handlers are driven directly with fake requests and a fake user service, so these tests need no
// database or Redis.

type FakeUser = { id: string; email: string; name: string; role: 'admin' | 'user' };

const ADMIN: FakeUser = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' };
const ALICE: FakeUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', role: 'user' };
const BOB: FakeUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', role: 'user' };
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
        create: vi.fn(async (email: string, _password: string, name: string) =>
            ({ id: 'u-new', email, name, role: 'user' as const })),
        createAccessToken: vi.fn(),
    };
}

function makeController(registration?: RegistrationPolicy) {
    const controller = new AuthController(baseConfig(registration));
    const users = fakeUserService();
    (controller as unknown as { userService: unknown }).userService = users;
    // Creating a workspace touches the organisation tables; not what these tests are about.
    (controller as unknown as { ensureHumanWorkspace: () => Promise<void> }).ensureHumanWorkspace = async () => {};
    return { controller, users };
}

function fakeReq(opts: { userId?: string; bearer?: string; body?: unknown; params?: Record<string, string> } = {}): Request {
    const session: Record<string, unknown> = { userId: opts.userId };
    session.regenerate = (cb: (err?: unknown) => void) => cb();
    return {
        session,
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
        expect(out.body).toEqual({ message: expect.stringMatching(/closed/i) });
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
