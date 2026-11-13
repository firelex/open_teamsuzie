import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SessionTracker } from '../services/session-tracker.js';
import type { AdminUserRow, AppRole, UserAdminStore } from '../services/user-admin-store.js';

export type UserAdminEvent =
    | { kind: 'invited'; actor: AdminUserRow; email: string; role: AppRole }
    | { kind: 'invite_revoked'; actor: AdminUserRow; inviteId: string }
    | { kind: 'joined'; target: AdminUserRow }
    | { kind: 'role_changed'; actor: AdminUserRow; target: AdminUserRow; from: AppRole; to: AppRole }
    | { kind: 'deactivated' | 'reactivated' | 'password_reset_issued' | 'removed'; actor: AdminUserRow; target: AdminUserRow }
    | { kind: 'password_reset_used'; target: AdminUserRow };

export interface UserAdminOptions {
    store: UserAdminStore;
    sessions: SessionTracker;
    /** Called after each successful change, before the response; a throw fails the request. */
    onChange: (event: UserAdminEvent) => void | Promise<void>;
    /** May throw `{ code: 409, message }` to refuse a removal. */
    beforeDelete: (target: AdminUserRow) => void | Promise<void>;
    now?: () => Date;
}

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 12;
const ROLES: AppRole[] = ['admin', 'user'];

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function fail(res: Response, status: number, error: string, message: string): void {
    res.status(status).json({ error, message });
}

/**
 * Turns a thrown error into a response: its `code` when it is an HTTP status, else 500. The error label is the
 * thrown error's own `error` string when it has one (e.g. the store's `{ code: 409, error: 'last_admin' }`) —
 * that is just labeling what was already decided elsewhere, not masking anything — and only falls back to a
 * generic label when the thrown error carries none.
 */
function answerError(res: Response, e: unknown): void {
    const err = e as { code?: unknown; message?: string; error?: unknown };
    const status = typeof err.code === 'number' && err.code >= 400 && err.code < 600 ? err.code : 500;
    const label = typeof err.error === 'string' ? err.error : (status === 500 ? 'internal' : 'refused');
    fail(res, status, label, err.message ?? String(e));
}

function passwordProblem(password: unknown): string | null {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `The password must be at least ${MIN_PASSWORD} characters`;
    return null;
}

/**
 * Admin-facing and public HTTP handlers for firm user administration: listing people, inviting, changing roles,
 * deactivating/reactivating, issuing password-reset links, removing people, and the public accept/reset flows for
 * people without an account yet.
 */
export class UserAdminController {
    constructor(private readonly opts: UserAdminOptions) {}

    private now(): Date {
        return this.opts.now ? this.opts.now() : new Date();
    }

    /** The calling admin, or null after answering 401/403. Read from the store, not the session copy. */
    private async admin(req: Request, res: Response): Promise<AdminUserRow | null> {
        const userId = (req.session as unknown as { userId?: string } | undefined)?.userId;
        if (!userId) { fail(res, 401, 'unauthorized', 'Not signed in'); return null; }
        const me = await this.opts.store.findUser(userId);
        if (!me || !me.is_active || me.role !== 'admin') { fail(res, 403, 'forbidden', 'Only an admin can manage people'); return null; }
        return me;
    }

    /** Ends the target's sessions and tokens. Throws if that fails, so the request fails. */
    private async signOut(userId: string): Promise<void> {
        await this.opts.sessions.endSessionsFor(userId);
        await this.opts.store.revokeAccessTokens(userId);
    }

    /**
     * Runs `work` (the onChange calls), then always signs `userId` out, so a failing app hook never leaves the
     * person signed in after their change was written. No error is lost: if only one step failed, that error is
     * rethrown unchanged (its `code`/`error` still pick the response); if both failed, the thrown error names
     * both messages and keeps the work error's `code`/`error`.
     */
    private async thenSignOut(userId: string, work: () => Promise<void>): Promise<void> {
        let workErr: unknown = null;
        let workFailed = false;
        try {
            await work();
        } catch (e) {
            workFailed = true;
            workErr = e;
        }
        try {
            await this.signOut(userId);
        } catch (signOutErr) {
            if (!workFailed) throw signOutErr;
            const w = workErr as { message?: unknown; code?: unknown; error?: unknown };
            const workMessage = workErr instanceof Error ? workErr.message : String(workErr);
            const signOutMessage = signOutErr instanceof Error ? signOutErr.message : String(signOutErr);
            const combined = new Error(`${workMessage}; and signing the person out also failed: ${signOutMessage}`, { cause: workErr });
            throw Object.assign(combined, {
                ...(w && w.code !== undefined ? { code: w.code } : {}),
                ...(w && w.error !== undefined ? { error: w.error } : {}),
            });
        }
        if (workFailed) throw workErr;
    }

    listUsers = async (req: Request, res: Response): Promise<void> => {
        try {
            if (!(await this.admin(req, res))) return;
            res.status(200).json({ users: await this.opts.store.listUsers() });
        } catch (e) { answerError(res, e); }
    };

    createInvite = async (req: Request, res: Response): Promise<void> => {
        try {
            const me = await this.admin(req, res);
            if (!me) return;
            const email = String((req.body as Record<string, unknown> | undefined)?.email ?? '').trim().toLowerCase();
            const role = (req.body as Record<string, unknown> | undefined)?.role as AppRole;
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'invalid', 'Enter a valid email address');
            if (!ROLES.includes(role)) return fail(res, 400, 'invalid', 'role must be admin or user');
            if (await this.opts.store.findUserByEmail(email)) return fail(res, 409, 'account_exists', `${email} already has an account`);
            const token = randomBytes(32).toString('hex');
            const invite = await this.opts.store.createInvite({
                email, role, createdBy: me.id, tokenHash: hashToken(token), expiresAt: new Date(this.now().getTime() + INVITE_MS),
            });
            await this.opts.onChange({ kind: 'invited', actor: me, email, role });
            res.status(201).json({ invite, path: `/join/${token}` });
        } catch (e) { answerError(res, e); }
    };

    listInvites = async (req: Request, res: Response): Promise<void> => {
        try {
            if (!(await this.admin(req, res))) return;
            res.status(200).json({ invites: await this.opts.store.listOpenInvites(this.now()) });
        } catch (e) { answerError(res, e); }
    };

    revokeInvite = async (req: Request, res: Response): Promise<void> => {
        try {
            const me = await this.admin(req, res);
            if (!me) return;
            const id = String(req.params.id);
            if (!(await this.opts.store.revokeInvite(id))) return fail(res, 404, 'not_found', 'No open invite with that id');
            await this.opts.onChange({ kind: 'invite_revoked', actor: me, inviteId: id });
            res.status(200).json({ ok: true });
        } catch (e) { answerError(res, e); }
    };

    updateUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const me = await this.admin(req, res);
            if (!me) return;
            const target = await this.opts.store.findUser(String(req.params.id));
            if (!target) return fail(res, 404, 'not_found', 'No such person');
            const body = req.body as Record<string, unknown> | undefined;
            const role = body?.role as AppRole | undefined;
            const isActive = body?.is_active as boolean | undefined;
            if (role !== undefined && !ROLES.includes(role)) return fail(res, 400, 'invalid', 'role must be admin or user');
            if (isActive !== undefined && typeof isActive !== 'boolean') return fail(res, 400, 'invalid', 'is_active must be true or false');
            if (role === undefined && isActive === undefined) return fail(res, 400, 'invalid', 'Nothing to change');
            // Snapshot the prior role/active state before the store call: the store may mutate and return
            // the same object `findUser` gave us, so reading `target` again afterwards would see the new
            // values. The last-admin rule itself is enforced atomically inside the store's own transaction
            // (it locks the active-admin rows before deciding), not here, so two concurrent demotions of
            // different admins can't both pass a stale, separately-read count.
            const previousRole = target.role;
            const previousActive = target.is_active;
            const updated = await this.opts.store.updateUser(target.id, {
                ...(role !== undefined ? { role } : {}), ...(isActive !== undefined ? { is_active: isActive } : {}),
            }, me.id);
            const roleChanged = role !== undefined && role !== previousRole;
            const activeChanged = isActive !== undefined && isActive !== previousActive;
            // Record the audit events right after the write, then sign out: if ending sessions fails, the
            // change and its event are already recorded, and the request still fails loud with the real
            // error. Sign-out runs even when onChange throws (thenSignOut), so the person never keeps a
            // session after the change itself was written, and neither error is lost. Only end
            // sessions/tokens when something actually changed: a PATCH that merely restates the current
            // role/active state must not sign them out.
            if (roleChanged || activeChanged) {
                await this.thenSignOut(target.id, async () => {
                    if (roleChanged) {
                        await this.opts.onChange({ kind: 'role_changed', actor: me, target: updated, from: previousRole, to: role! });
                    }
                    if (activeChanged) {
                        await this.opts.onChange({ kind: isActive ? 'reactivated' : 'deactivated', actor: me, target: updated });
                    }
                });
            }
            res.status(200).json({ user: updated });
        } catch (e) { answerError(res, e); }
    };

    createPasswordReset = async (req: Request, res: Response): Promise<void> => {
        try {
            const me = await this.admin(req, res);
            if (!me) return;
            const target = await this.opts.store.findUser(String(req.params.id));
            if (!target) return fail(res, 404, 'not_found', 'No such person');
            if (!target.is_active) return fail(res, 409, 'deactivated', 'Reactivate this person before resetting their password');
            const token = randomBytes(32).toString('hex');
            const expiresAt = new Date(this.now().getTime() + RESET_MS);
            await this.opts.store.createResetToken({ userId: target.id, tokenHash: hashToken(token), expiresAt, createdBy: me.id });
            await this.opts.onChange({ kind: 'password_reset_issued', actor: me, target });
            res.status(201).json({ path: `/reset/${token}`, expires_at: expiresAt.toISOString() });
        } catch (e) { answerError(res, e); }
    };

    deleteUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const me = await this.admin(req, res);
            if (!me) return;
            const target = await this.opts.store.findUser(String(req.params.id));
            if (!target) return fail(res, 404, 'not_found', 'No such person');
            // The store enforces the last-admin rule itself (same atomic check as updateUser) when it
            // deletes the row, so there is no separate pre-check here.
            await this.opts.beforeDelete(target);
            await this.opts.store.deleteUser(target.id);
            // Ending sessions by user id still works once the row is gone; doing it last means a failure
            // here never hides that the removal (and its audit event) already happened. It runs even when
            // onChange throws (e.g. the app's clean-up failed), so a removed person is never left signed in;
            // thenSignOut reports both errors if both steps fail.
            await this.thenSignOut(target.id, async () => {
                await this.opts.onChange({ kind: 'removed', actor: me, target });
            });
            res.status(200).json({ ok: true });
        } catch (e) { answerError(res, e); }
    };

    lookupInvite = async (req: Request, res: Response): Promise<void> => {
        try {
            const found = await this.opts.store.lookupInvite(hashToken(String(req.params.token)), this.now());
            if (!found) return fail(res, 404, 'not_found', 'This invite link is not valid');
            res.status(200).json({ email: found.invite.email, role: found.invite.role, organizationName: found.organizationName, state: found.state });
        } catch (e) { answerError(res, e); }
    };

    acceptInvite = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = req.body as Record<string, unknown> | undefined;
            const name = String(body?.name ?? '').trim();
            if (!name) return fail(res, 400, 'invalid', 'Enter your name');
            const problem = passwordProblem(body?.password);
            if (problem) return fail(res, 400, 'invalid', problem);
            const user = await this.opts.store.acceptInvite(hashToken(String(req.params.token)), { name, password: body!.password as string });
            await this.opts.onChange({ kind: 'joined', target: user });
            req.session.regenerate(async (err: unknown) => {
                if (err) return fail(res, 500, 'internal', `Session error: ${String(err)}`);
                try {
                    const s = req.session as unknown as Record<string, unknown>;
                    s.userId = user.id; s.userEmail = user.email; s.userName = user.name; s.userRole = user.role;
                    await this.opts.sessions.track(user.id, req.sessionID);
                    res.status(201).json({ user });
                } catch (e) { answerError(res, e); }
            });
        } catch (e) { answerError(res, e); }
    };

    usePasswordReset = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = req.body as Record<string, unknown> | undefined;
            const problem = passwordProblem(body?.password);
            if (problem) return fail(res, 400, 'invalid', problem);
            const result = await this.opts.store.useResetToken(hashToken(String(req.params.token)), body!.password as string, this.now());
            if (result === 'invalid') return fail(res, 410, 'invalid_link', 'This reset link is no longer valid. Ask an admin for a new one.');
            // Same ordering as updateUser/deleteUser: record the event right after the write, then sign
            // out (even if onChange throws), so a session-ending failure can never make the password change
            // or its event disappear, and an onChange failure never leaves old sessions alive.
            await this.thenSignOut(result.id, async () => {
                await this.opts.onChange({ kind: 'password_reset_used', target: result });
            });
            res.status(200).json({ ok: true });
        } catch (e) { answerError(res, e); }
    };
}
