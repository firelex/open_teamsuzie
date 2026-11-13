import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { UserAdminController, hashToken, type UserAdminEvent } from '../controllers/user-admin.js';
import { SessionTracker } from '../services/session-tracker.js';
import type { AdminUserRow, AppRole, InviteRow, UserAdminStore } from '../services/user-admin-store.js';

const NOW = new Date('2026-11-13T12:00:00Z');
const person = (id: string, role: AppRole, is_active = true): AdminUserRow =>
    ({ id, email: `${id}@firm.test`, name: id, role, is_active, created_at: NOW.toISOString(), last_sign_in_at: null });

/** Same shape the real store throws from `updateUser`/`deleteUser` when a change would leave no active admin. */
function lastAdminError(): Error {
    return Object.assign(
        new Error('The firm must keep at least one active admin. Make someone else an admin first.'),
        { code: 409, error: 'last_admin' },
    );
}

function fakeStore(users: AdminUserRow[]) {
    const invites: Array<InviteRow & { tokenHash: string; used: boolean; revoked: boolean }> = [];
    // How many OTHER active admins there are besides `id` — mirrors the real store's locked read of the
    // active-admin rows, just without a database: since this fake has no internal `await` between reading
    // `users` and mutating it, two calls made "concurrently" from the test (e.g. via Promise.all) still run
    // this check-then-write atomically relative to each other, the same way the real store's transaction does.
    const otherActiveAdmins = (id: string) => users.filter((u) => u.role === 'admin' && u.is_active && u.id !== id).length;
    const store: UserAdminStore = {
        listUsers: async () => users,
        findUser: async (id) => users.find((u) => u.id === id) ?? null,
        findUserByEmail: async (e) => users.find((u) => u.email === e.toLowerCase()) ?? null,
        createInvite: async ({ email, role, tokenHash, expiresAt }) => {
            const inv = { id: `i${invites.length + 1}`, email, role, expires_at: expiresAt.toISOString(),
                created_at: NOW.toISOString(), created_by_email: 'ann@firm.test', tokenHash, used: false, revoked: false };
            invites.push(inv);
            return inv;
        },
        listOpenInvites: async () => invites.filter((i) => !i.used && !i.revoked),
        revokeInvite: async (id) => { const i = invites.find((x) => x.id === id); if (!i) return false; i.revoked = true; return true; },
        lookupInvite: async (h) => {
            const i = invites.find((x) => x.tokenHash === h);
            if (!i) return null;
            const state = i.revoked ? 'revoked' : i.used ? 'used' : new Date(i.expires_at) <= NOW ? 'expired' : 'open';
            return { invite: i, organizationName: 'Firm', state };
        },
        acceptInvite: async (h, { name }) => {
            const i = invites.find((x) => x.tokenHash === h);
            if (!i || i.used || i.revoked) throw Object.assign(new Error('This invite link is no longer valid'), { code: 410 });
            i.used = true;
            const u = { ...person(name, i.role), email: i.email };
            users.push(u);
            return u;
        },
        updateUser: async (id, patch) => {
            const u = users.find((x) => x.id === id)!;
            const wasActiveAdmin = u.role === 'admin' && u.is_active;
            const staysActiveAdmin = (patch.role ?? u.role) === 'admin' && (patch.is_active ?? u.is_active);
            if (wasActiveAdmin && !staysActiveAdmin && otherActiveAdmins(u.id) === 0) throw lastAdminError();
            Object.assign(u, patch);
            return u;
        },
        revokeAccessTokens: vi.fn(async () => {}),
        createResetToken: vi.fn(async () => {}),
        useResetToken: vi.fn(async () => 'invalid' as const),
        deleteUser: vi.fn(async (id: string) => {
            const u = users.find((x) => x.id === id)!;
            const wasActiveAdmin = u.role === 'admin' && u.is_active;
            if (wasActiveAdmin && otherActiveAdmins(u.id) === 0) throw lastAdminError();
            users.splice(users.findIndex((x) => x.id === id), 1);
        }),
    };
    return { store, invites };
}

function setup(users: AdminUserRow[], beforeDelete = async () => {}) {
    const { store, invites } = fakeStore(users);
    const ended: string[] = [];
    const sessions = {
        endSessionsFor: async (id: string) => { ended.push(id); return 1; },
        // acceptInvite signs the newly-joined person in the same way the login/register flow does
        // (regenerate the session, then track it), so the fake needs this method too.
        track: async () => {},
    } as unknown as SessionTracker;
    const events: UserAdminEvent[] = [];
    const c = new UserAdminController({ store, sessions, onChange: (e) => { events.push(e); }, beforeDelete, now: () => NOW });
    return { c, store, invites, ended, events };
}

function req(userId: string | undefined, opts: { body?: unknown; params?: Record<string, string> } = {}): Request {
    const session: Record<string, unknown> = { userId, regenerate: (cb: () => void) => cb() };
    return { session, sessionID: 'sid', body: opts.body ?? {}, params: opts.params ?? {} } as unknown as Request;
}
async function call(h: (q: Request, s: Response) => Promise<void>, q: Request) {
    const out = { status: 0, body: undefined as any };
    const res = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
    await h(q, res as unknown as Response);
    await new Promise((r) => setImmediate(r));
    return out;
}

describe('who may use the admin routes', () => {
    it('refuses a signed-out caller, a plain user and a deactivated admin', async () => {
        const { c } = setup([person('ann', 'admin'), person('bob', 'user'), person('cat', 'admin', false)]);
        expect((await call(c.listUsers, req(undefined))).status).toBe(401);
        expect((await call(c.listUsers, req('bob'))).status).toBe(403);
        expect((await call(c.listUsers, req('cat'))).status).toBe(403);
        expect((await call(c.listUsers, req('ann'))).status).toBe(200);
    });
});

describe('invites', () => {
    it('creates a one-time link bound to the lower-cased email that expires in 7 days', async () => {
        const { c, invites, events } = setup([person('ann', 'admin')]);
        const out = await call(c.createInvite, req('ann', { body: { email: ' Dee@Firm.TEST ', role: 'user' } }));
        expect(out.status).toBe(201);
        expect(out.body.path).toMatch(/^\/join\/[0-9a-f]{64}$/);
        expect(invites[0]!.email).toBe('dee@firm.test');
        expect(invites[0]!.tokenHash).toBe(hashToken(out.body.path.slice(6)));
        expect(invites[0]!.expires_at).toBe('2026-11-20T12:00:00.000Z');
        expect(events[0]).toMatchObject({ kind: 'invited', email: 'dee@firm.test', role: 'user' });
    });

    it('refuses an email that already has an account, in any case, and a bad role', async () => {
        const { c } = setup([person('ann', 'admin')]);
        expect((await call(c.createInvite, req('ann', { body: { email: 'ANN@firm.test', role: 'user' } }))).body.error).toBe('account_exists');
        expect((await call(c.createInvite, req('ann', { body: { email: 'x@firm.test', role: 'owner' } }))).status).toBe(400);
    });

    it('accepts once; a second accept and an accept after revoke answer 410', async () => {
        const { c } = setup([person('ann', 'admin')]);
        const token = (await call(c.createInvite, req('ann', { body: { email: 'dee@firm.test', role: 'user' } }))).body.path.slice(6);
        const first = await call(c.acceptInvite, req(undefined, { params: { token }, body: { name: 'Dee', password: 'twelve-chars-ok' } }));
        expect(first.status).toBe(201);
        const again = await call(c.acceptInvite, req(undefined, { params: { token }, body: { name: 'Dee', password: 'twelve-chars-ok' } }));
        expect(again.status).toBe(410);

        const t2 = (await call(c.createInvite, req('ann', { body: { email: 'eve@firm.test', role: 'user' } }))).body.path.slice(6);
        const id = (await call(c.listInvites, req('ann'))).body.invites.find((i: InviteRow) => i.email === 'eve@firm.test').id;
        await call(c.revokeInvite, req('ann', { params: { id } }));
        const lookup = await call(c.lookupInvite, req(undefined, { params: { token: t2 } }));
        expect(lookup.body.state).toBe('revoked');
        expect((await call(c.acceptInvite, req(undefined, { params: { token: t2 }, body: { name: 'Eve', password: 'twelve-chars-ok' } }))).status).toBe(410);
    });

    it('refuses a password shorter than 12 characters', async () => {
        const { c } = setup([person('ann', 'admin')]);
        const token = (await call(c.createInvite, req('ann', { body: { email: 'dee@firm.test', role: 'user' } }))).body.path.slice(6);
        const out = await call(c.acceptInvite, req(undefined, { params: { token }, body: { name: 'Dee', password: 'short' } }));
        expect(out.status).toBe(400);
    });
});

describe('the last active admin', () => {
    it('cannot be demoted, deactivated or removed — not even by themselves', async () => {
        const { c } = setup([person('ann', 'admin'), person('bob', 'user')]);
        for (const body of [{ role: 'user' }, { is_active: false }]) {
            const out = await call(c.updateUser, req('ann', { params: { id: 'ann' }, body }));
            expect(out.status).toBe(409);
            expect(out.body.error).toBe('last_admin');
        }
        expect((await call(c.deleteUser, req('ann', { params: { id: 'ann' } }))).body.error).toBe('last_admin');
    });

    it('with a second admin, self-demotion works and ends the caller’s sessions', async () => {
        const { c, ended, events } = setup([person('ann', 'admin'), person('bob', 'admin')]);
        const out = await call(c.updateUser, req('ann', { params: { id: 'ann' }, body: { role: 'user' } }));
        expect(out.status).toBe(200);
        expect(ended).toEqual(['ann']);
        expect(events[0]).toMatchObject({ kind: 'role_changed', from: 'admin', to: 'user' });
    });

    it('a single request demoting and deactivating the last admin at once is still refused', async () => {
        const { c } = setup([person('ann', 'admin'), person('bob', 'user')]);
        const out = await call(c.updateUser, req('ann', { params: { id: 'ann' }, body: { role: 'user', is_active: false } }));
        expect(out.status).toBe(409);
        expect(out.body.error).toBe('last_admin');
    });

    it('two admins demoting each other at the same time cannot both succeed and leave zero admins', async () => {
        const { c } = setup([person('ann', 'admin'), person('bob', 'admin')]);
        const [r1, r2] = await Promise.all([
            call(c.updateUser, req('ann', { params: { id: 'bob' }, body: { role: 'user' } })),
            call(c.updateUser, req('bob', { params: { id: 'ann' }, body: { role: 'user' } })),
        ]);
        // Exactly one of the two demotions must win; the other must be refused as last_admin, so the firm
        // never ends up with zero admins even though each request only ever looked at a different target.
        expect([r1.status, r2.status].sort()).toEqual([200, 409]);
        const refused = r1.status === 409 ? r1 : r2;
        expect(refused.body.error).toBe('last_admin');
    });
});

describe('changes end the target’s sessions and tokens', () => {
    it('deactivation ends sessions, revokes tokens and records the event', async () => {
        const { c, store, ended, events } = setup([person('ann', 'admin'), person('bob', 'user')]);
        const out = await call(c.updateUser, req('ann', { params: { id: 'bob' }, body: { is_active: false } }));
        expect(out.status).toBe(200);
        expect(ended).toEqual(['bob']);
        expect(store.revokeAccessTokens).toHaveBeenCalledWith('bob');
        expect(events[0]).toMatchObject({ kind: 'deactivated' });
    });

    it('fails the request when sessions cannot be ended, but keeps the already-saved change and its event', async () => {
        const { c, store, events } = setup([person('ann', 'admin'), person('bob', 'user')]);
        (c as any).opts.sessions = { endSessionsFor: async () => { throw new Error('redis down'); } };
        const out = await call(c.updateUser, req('ann', { params: { id: 'bob' }, body: { is_active: false } }));
        expect(out.status).toBe(500);
        expect(out.body.message).toBe('redis down');
        // The store write and the audit event happen before sign-out, so a Redis failure here never loses
        // either of them — only ending the session failed, not the change itself.
        expect((await store.findUser('bob'))!.is_active).toBe(false);
        expect(events[0]).toMatchObject({ kind: 'deactivated' });
    });

    it('a PATCH that only restates the current role/active state changes nothing and signs no one out', async () => {
        const { c, store, ended, events } = setup([person('ann', 'admin'), person('bob', 'user')]);
        const out = await call(c.updateUser, req('ann', { params: { id: 'bob' }, body: { role: 'user' } }));
        expect(out.status).toBe(200);
        expect(ended).toEqual([]);
        expect(events).toEqual([]);
        expect(store.revokeAccessTokens).not.toHaveBeenCalled();
    });
});

describe('removal', () => {
    it('passes the app’s refusal through as 409 with its message', async () => {
        const { c, store } = setup([person('ann', 'admin'), person('bob', 'user')], async () => {
            throw Object.assign(new Error('Bob is the only owner of "Acme v Beta"'), { code: 409 });
        });
        const out = await call(c.deleteUser, req('ann', { params: { id: 'bob' } }));
        expect(out.status).toBe(409);
        expect(out.body.message).toBe('Bob is the only owner of "Acme v Beta"');
        expect(store.deleteUser).not.toHaveBeenCalled();
    });
});

describe('password reset links', () => {
    it('issues a 24-hour link and stores only the hash', async () => {
        const { c, store } = setup([person('ann', 'admin'), person('bob', 'user')]);
        const out = await call(c.createPasswordReset, req('ann', { params: { id: 'bob' } }));
        expect(out.status).toBe(201);
        const token = out.body.path.slice('/reset/'.length);
        expect(store.createResetToken).toHaveBeenCalledWith({ userId: 'bob', tokenHash: hashToken(token),
            expiresAt: new Date('2026-11-14T12:00:00Z'), createdBy: 'ann' });
    });

    it('answers 410 for an unknown or used token', async () => {
        const { c } = setup([person('ann', 'admin')]);
        const out = await call(c.usePasswordReset, req(undefined, { params: { token: 'nope' }, body: { password: 'twelve-chars-ok' } }));
        expect(out.status).toBe(410);
    });

    it('on success, signs the target out and records the event', async () => {
        const { c, store, ended, events } = setup([person('ann', 'admin'), person('bob', 'user')]);
        const bobAfterReset = person('bob', 'user');
        store.useResetToken = vi.fn(async () => bobAfterReset);
        const out = await call(c.usePasswordReset, req(undefined, { params: { token: 'tok' }, body: { password: 'twelve-chars-ok' } }));
        expect(out.status).toBe(200);
        expect(ended).toEqual(['bob']);
        expect(events[0]).toMatchObject({ kind: 'password_reset_used', target: bobAfterReset });
    });
});
