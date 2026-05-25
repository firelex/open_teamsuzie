import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { MembersStore, Role } from '@teamsuzie/sharing';
import type { WorkspacesStore } from '@teamsuzie/workspaces';

import { SUBJECT_MATTER } from './constants.js';

/**
 * Caller-supplied session lookup. Kept as a callback rather than reading
 * `req.session.user` directly so this package doesn't have to know which
 * auth strategy a host build uses (cookie / bearer / dev bypass).
 */
export type GetSessionUser = (
    req: Request,
) => { email: string } | null | undefined;

export interface CreateRequireMatterAccessOptions {
    members: MembersStore;
    workspaces: WorkspacesStore;
    getSessionUser: GetSessionUser;
}

/**
 * Express middleware that gates a matter-scoped path on the session user
 * having any role on that matter. Mount on `/api/matters/:matterId` (or
 * any nested path) so it intercepts every request that targets a
 * specific matter:
 *
 *   - 400 if `:matterId` is missing
 *   - 401 if no session user
 *   - 404 if the matter does not exist
 *   - 403 if the session user has no role on the matter
 *   - next() with the resolved role stashed at `req._matterRole` on success
 */
export function createRequireMatterAccess(
    opts: CreateRequireMatterAccessOptions,
): RequestHandler {
    const { members, workspaces, getSessionUser } = opts;
    return (req: Request, res: Response, next: NextFunction): void => {
        const matterId = String(req.params.matterId ?? '');
        if (!matterId) {
            res.status(400).json({ error: 'matterId required' });
            return;
        }
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
        (req as Request & { _matterRole?: Role })._matterRole = role;
        next();
    };
}

export interface BackfillMatterOwnershipOptions {
    members: MembersStore;
    workspaces: WorkspacesStore;
    ownerEmail: string;
}

/**
 * Demo / single-user bridge: every matter that has no member row gets
 * `ownerEmail` granted as owner. Without this, matters created before
 * `requireMatterAccess` lit up become unreachable to the demo user.
 *
 * Multi-user production deployments should fail-closed and require
 * manual repair instead — don't call this when real auth is on.
 *
 * Includes archived matters so archive doesn't strand a matter from
 * being unarchivable later. Idempotent — re-running grants nothing on
 * the second pass.
 */
export function backfillMatterOwnership(
    opts: BackfillMatterOwnershipOptions,
): { granted: number } {
    const { members, workspaces, ownerEmail } = opts;
    let granted = 0;
    for (const w of workspaces.listWorkspaces({ includeArchived: true })) {
        const existing = members.listMembersFor({
            type: SUBJECT_MATTER,
            id: w.id,
        });
        if (existing.length === 0) {
            members.addMember({
                subjectType: SUBJECT_MATTER,
                subjectId: w.id,
                userId: ownerEmail,
                role: 'owner',
                grantedBy: null,
            });
            granted += 1;
        }
    }
    return { granted };
}
