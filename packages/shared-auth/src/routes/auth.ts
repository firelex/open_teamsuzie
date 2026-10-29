import { Router } from 'express';
import AuthController from '../controllers/auth.js';
import type { SharedAuthConfig } from '../types.js';

export function createAuthRouter(config: SharedAuthConfig): Router {
    const router = Router();
    const controller = new AuthController(config);

    router.get('/me', controller.me);
    router.get('/introspect', controller.introspect);
    router.get('/validate', controller.introspect);
    router.post('/login', controller.login);
    router.post('/logout', controller.logout);
    if (config.allow_registration) {
        router.post('/register', controller.register);
    } else {
        router.post('/register', (_req, res) => {
            res.status(403).json({ message: 'Registration is closed: ask an admin to create your account' });
        });
    }
    router.get('/tokens', controller.listAccessTokens);
    router.post('/tokens', controller.createAccessToken);
    router.delete('/tokens/:id', controller.revokeAccessToken);
    router.get('/users', controller.listUsers);
    router.get('/users/by-email/:email', controller.lookupByEmail);

    return router;
}
