import { Router } from 'express';
import { UserAdminController, type UserAdminOptions } from '../controllers/user-admin.js';

/** Admin-only people management. Every handler checks that the caller is an active admin. */
export function createUserAdminRouter(opts: UserAdminOptions): Router {
    const c = new UserAdminController(opts);
    const router = Router();
    router.get('/users', c.listUsers);
    router.patch('/users/:id', c.updateUser);
    router.delete('/users/:id', c.deleteUser);
    router.post('/users/:id/password-reset', c.createPasswordReset);
    router.get('/invites', c.listInvites);
    router.post('/invites', c.createInvite);
    router.delete('/invites/:id', c.revokeInvite);
    return router;
}

/** Routes a person without an account (or a password) uses with a link an admin gave them. */
export function createUserAdminPublicRouter(opts: UserAdminOptions): Router {
    const c = new UserAdminController(opts);
    const router = Router();
    router.get('/invites/:token', c.lookupInvite);
    router.post('/invites/:token/accept', c.acceptInvite);
    router.post('/password-reset/:token', c.usePasswordReset);
    return router;
}
