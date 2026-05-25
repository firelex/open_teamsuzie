import { Router, type Request, type Response } from 'express';
import type { MembersStore, Role } from '@teamsuzie/sharing';
import { ROLES } from '@teamsuzie/sharing';
import type { WorkspacesStore } from '@teamsuzie/workspaces';

import { SUBJECT_MATTER } from './constants.js';
import type { GetSessionUser } from './access-middleware.js';

export interface CreateMatterMembersRouterOptions {
    members: MembersStore;
    workspaces: WorkspacesStore;
    getSessionUser: GetSessionUser;
}

function lowerEmail(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function parseRole(raw: unknown): Role | null {
    if (typeof raw !== 'string') return null;
    return (ROLES as readonly string[]).includes(raw) ? (raw as Role) : null;
}

/**
 * Member CRUD for matters. Mount under `/api/matters/:matterId/members`.
 *
 *   GET    /              — any member can list (so editors / viewers can
 *                           render the share dialog state, even if they
 *                           can't mutate it). Returns `{ items, role }`.
 *   POST   /              — owner-only. Add a member by `{ email, role }`.
 *                           Email is lowercased.
 *   DELETE /:userId       — owner-only. Removing the last owner is
 *                           blocked so a matter cannot be orphaned.
 */
export function createMatterMembersRouter(
    opts: CreateMatterMembersRouterOptions,
): Router {
    const { members, workspaces, getSessionUser } = opts;
    const router: Router = Router({ mergeParams: true });

    function requireOwner(
        req: Request,
        res: Response,
    ): { matterId: string; userId: string } | null {
        const matterId = String(
            (req.params as { matterId?: string }).matterId ?? '',
        );
        const user = getSessionUser(req);
        if (!user?.email) {
            res.status(401).json({ error: 'unauthenticated' });
            return null;
        }
        if (!workspaces.getWorkspace(matterId)) {
            res.status(404).json({ error: 'matter not found' });
            return null;
        }
        const role = members.getRole(
            { type: SUBJECT_MATTER, id: matterId },
            user.email,
        );
        if (role !== 'owner') {
            res.status(403).json({ error: 'forbidden' });
            return null;
        }
        return { matterId, userId: user.email };
    }

    router.get('/', (req, res) => {
        const matterId = String(
            (req.params as { matterId?: string }).matterId ?? '',
        );
        const user = getSessionUser(req);
        if (!user?.email) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        if (!workspaces.getWorkspace(matterId)) {
            res.status(404).json({ error: 'matter not found' });
            return;
        }
        const role = members.getRole(
            { type: SUBJECT_MATTER, id: matterId },
            user.email,
        );
        if (!role) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const items = members.listMembersFor({
            type: SUBJECT_MATTER,
            id: matterId,
        });
        res.json({ items, role });
    });

    router.post('/', (req, res) => {
        const ctx = requireOwner(req, res);
        if (!ctx) return;
        const inviteEmail = lowerEmail(req.body?.email);
        const role = parseRole(req.body?.role);
        if (!inviteEmail) {
            res.status(400).json({ error: 'email is required' });
            return;
        }
        if (!role) {
            res.status(400).json({
                error: 'role must be one of owner, editor, viewer',
            });
            return;
        }
        const member = members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: ctx.matterId,
            userId: inviteEmail,
            role,
            grantedBy: ctx.userId,
        });
        res.status(201).json({ item: member });
    });

    router.delete('/:userId', (req, res) => {
        const ctx = requireOwner(req, res);
        if (!ctx) return;
        const target = lowerEmail(req.params.userId);
        if (!target) {
            res.status(400).json({ error: 'userId required' });
            return;
        }
        // Block removing the last owner — keeps every matter reachable
        // by at least one user.
        const all = members.listMembersFor({
            type: SUBJECT_MATTER,
            id: ctx.matterId,
        });
        const owners = all.filter((m) => m.role === 'owner');
        const targetIsOwner = owners.some((m) => m.userId === target);
        if (targetIsOwner && owners.length <= 1) {
            res.status(400).json({ error: 'cannot remove the last owner' });
            return;
        }
        const removed = members.removeMember(SUBJECT_MATTER, ctx.matterId, target);
        if (!removed) {
            res.status(404).json({ error: 'member not found' });
            return;
        }
        res.json({ ok: true });
    });

    return router;
}
