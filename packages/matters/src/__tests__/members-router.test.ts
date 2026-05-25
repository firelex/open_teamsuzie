import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';
import { MembersStore, SHARING_MIGRATIONS } from '@teamsuzie/sharing';

import { createMatterMembersRouter } from '../members-router.js';
import { SUBJECT_MATTER } from '../constants.js';

let db: DatabaseInstance;
let workspaces: WorkspacesStore;
let members: MembersStore;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: [...WORKSPACES_MIGRATIONS, ...SHARING_MIGRATIONS],
    });
    workspaces = new WorkspacesStore({ db });
    members = new MembersStore({ db });
});

afterEach(() => {
    db.close();
});

function makeApp(sessionEmail: string | null): express.Express {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        (req as Request & { _user?: { email: string } | null })._user =
            sessionEmail ? { email: sessionEmail } : null;
        next();
    });
    app.use(
        '/api/matters/:matterId/members',
        createMatterMembersRouter({
            members,
            workspaces,
            getSessionUser: (req) =>
                (req as Request & { _user?: { email: string } | null })._user ??
                null,
        }),
    );
    return app;
}

describe('createMatterMembersRouter — GET /', () => {
    it('returns 401 when no session user', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        const res = await request(makeApp(null)).get(
            `/api/matters/${matter.id}/members`,
        );
        expect(res.status).toBe(401);
    });

    it('returns 404 when the matter does not exist', async () => {
        const res = await request(makeApp('owner@x.com')).get(
            '/api/matters/missing/members',
        );
        expect(res.status).toBe(404);
    });

    it('returns 403 when the session user has no role on the matter', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        const res = await request(makeApp('stranger@x.com')).get(
            `/api/matters/${matter.id}/members`,
        );
        expect(res.status).toBe(403);
    });

    it('lists members and the session role for any member (viewers included)', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'viewer@x.com',
            role: 'viewer',
            grantedBy: 'owner@x.com',
        });
        const res = await request(makeApp('viewer@x.com')).get(
            `/api/matters/${matter.id}/members`,
        );
        expect(res.status).toBe(200);
        expect(res.body.role).toBe('viewer');
        expect(res.body.items).toHaveLength(2);
    });
});

describe('createMatterMembersRouter — POST /', () => {
    it('returns 403 when a non-owner tries to add a member', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'editor@x.com',
            role: 'editor',
            grantedBy: null,
        });
        const res = await request(makeApp('editor@x.com'))
            .post(`/api/matters/${matter.id}/members`)
            .send({ email: 'newbie@x.com', role: 'viewer' });
        expect(res.status).toBe(403);
    });

    it('returns 400 when email is missing', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        const res = await request(makeApp('owner@x.com'))
            .post(`/api/matters/${matter.id}/members`)
            .send({ role: 'viewer' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 when role is missing or invalid', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        const res = await request(makeApp('owner@x.com'))
            .post(`/api/matters/${matter.id}/members`)
            .send({ email: 'newbie@x.com', role: 'admin' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/role/i);
    });

    it('owners can add a new member and the email is lowercased', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        const res = await request(makeApp('owner@x.com'))
            .post(`/api/matters/${matter.id}/members`)
            .send({ email: 'Editor@X.com', role: 'editor' });
        expect(res.status).toBe(201);
        expect(res.body.item.userId).toBe('editor@x.com');
        expect(res.body.item.role).toBe('editor');
    });
});

describe('createMatterMembersRouter — DELETE /:userId', () => {
    it('returns 403 when a non-owner tries to remove a member', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'editor@x.com',
            role: 'editor',
            grantedBy: null,
        });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'viewer@x.com',
            role: 'viewer',
            grantedBy: null,
        });
        const res = await request(makeApp('editor@x.com')).delete(
            `/api/matters/${matter.id}/members/viewer@x.com`,
        );
        expect(res.status).toBe(403);
    });

    it('removes a member when invoked by an owner', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'viewer@x.com',
            role: 'viewer',
            grantedBy: 'owner@x.com',
        });
        const res = await request(makeApp('owner@x.com')).delete(
            `/api/matters/${matter.id}/members/viewer@x.com`,
        );
        expect(res.status).toBe(200);
        expect(
            members.getRole(
                { type: SUBJECT_MATTER, id: matter.id },
                'viewer@x.com',
            ),
        ).toBeNull();
    });

    it('blocks removing the last owner so a matter cannot be orphaned', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        const res = await request(makeApp('owner@x.com')).delete(
            `/api/matters/${matter.id}/members/owner@x.com`,
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/last owner/i);
        // Owner row must still be there.
        expect(
            members.getRole(
                { type: SUBJECT_MATTER, id: matter.id },
                'owner@x.com',
            ),
        ).toBe('owner');
    });

    it('returns 404 when removing a non-member', async () => {
        const matter = workspaces.createWorkspace({ name: 'm' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'owner@x.com',
            role: 'owner',
            grantedBy: null,
        });
        const res = await request(makeApp('owner@x.com')).delete(
            `/api/matters/${matter.id}/members/ghost@x.com`,
        );
        expect(res.status).toBe(404);
    });
});
