import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';
import { MembersStore, SHARING_MIGRATIONS } from '@teamsuzie/sharing';

import {
    backfillMatterOwnership,
    createRequireMatterAccess,
} from '../access-middleware.js';
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

function makeApp(opts: { sessionEmail: string | null }): express.Express {
    const app = express();
    app.use((req, _res, next) => {
        (req as Request & { _user?: { email: string } | null })._user =
            opts.sessionEmail ? { email: opts.sessionEmail } : null;
        next();
    });
    const requireMatterAccess = createRequireMatterAccess({
        members,
        workspaces,
        getSessionUser: (req) =>
            (req as Request & { _user?: { email: string } | null })._user ?? null,
    });
    app.use('/api/matters/:matterId', requireMatterAccess);
    app.get('/api/matters/:matterId/ping', (req, res) => {
        res.json({
            ok: true,
            matterId: req.params.matterId,
            role: (req as Request & { _matterRole?: string })._matterRole ?? null,
        });
    });
    return app;
}

describe('createRequireMatterAccess', () => {
    it('returns 401 when no session user is present', async () => {
        const matter = workspaces.createWorkspace({ name: 'Anon test' });
        const app = makeApp({ sessionEmail: null });
        const res = await request(app).get(`/api/matters/${matter.id}/ping`);
        expect(res.status).toBe(401);
    });

    it('returns 404 when the matter does not exist', async () => {
        const app = makeApp({ sessionEmail: 'someone@example.com' });
        const res = await request(app).get('/api/matters/missing/ping');
        expect(res.status).toBe(404);
    });

    it('returns 403 when the user has no role on the matter', async () => {
        const matter = workspaces.createWorkspace({ name: 'Walled garden' });
        const app = makeApp({ sessionEmail: 'outsider@example.com' });
        const res = await request(app).get(`/api/matters/${matter.id}/ping`);
        expect(res.status).toBe(403);
    });

    it('lets the request through and surfaces the role when the user is a member', async () => {
        const matter = workspaces.createWorkspace({ name: 'Co-counsel matter' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: matter.id,
            userId: 'editor@example.com',
            role: 'editor',
            grantedBy: 'owner@example.com',
        });
        const app = makeApp({ sessionEmail: 'editor@example.com' });
        const res = await request(app).get(`/api/matters/${matter.id}/ping`);
        expect(res.status).toBe(200);
        expect(res.body.role).toBe('editor');
    });
});

describe('backfillMatterOwnership', () => {
    it('grants owner on every matter that has no member rows', () => {
        const a = workspaces.createWorkspace({ name: 'Pre-membership 1' });
        const b = workspaces.createWorkspace({ name: 'Pre-membership 2' });
        const c = workspaces.createWorkspace({ name: 'Already shared' });
        members.addMember({
            subjectType: SUBJECT_MATTER,
            subjectId: c.id,
            userId: 'existing@example.com',
            role: 'owner',
            grantedBy: null,
        });

        const result = backfillMatterOwnership({
            members,
            workspaces,
            ownerEmail: 'demo@example.com',
        });

        expect(result.granted).toBe(2);
        expect(
            members.getRole({ type: SUBJECT_MATTER, id: a.id }, 'demo@example.com'),
        ).toBe('owner');
        expect(
            members.getRole({ type: SUBJECT_MATTER, id: b.id }, 'demo@example.com'),
        ).toBe('owner');
        // Already-shared matter must not get a second owner row.
        expect(
            members.getRole({ type: SUBJECT_MATTER, id: c.id }, 'demo@example.com'),
        ).toBeNull();
    });

    it('is idempotent when run twice', () => {
        workspaces.createWorkspace({ name: 'Solo' });
        const first = backfillMatterOwnership({
            members,
            workspaces,
            ownerEmail: 'demo@example.com',
        });
        const second = backfillMatterOwnership({
            members,
            workspaces,
            ownerEmail: 'demo@example.com',
        });
        expect(first.granted).toBe(1);
        expect(second.granted).toBe(0);
    });

    it('includes archived matters in the backfill', () => {
        const m = workspaces.createWorkspace({ name: 'Closed matter' });
        workspaces.archiveWorkspace(m.id);
        const result = backfillMatterOwnership({
            members,
            workspaces,
            ownerEmail: 'demo@example.com',
        });
        expect(result.granted).toBe(1);
    });
});
