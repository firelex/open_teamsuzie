import { Router } from 'express';
import AuthController from '../controllers/auth.js';
import type { SharedAuthConfig } from '../types.js';

export function createAuthRouter(config: SharedAuthConfig): Router {
    const router = Router();
    const controller = new AuthController(config);

    router.get('/me', controller.me);
    router.post('/login', controller.login);
    router.post('/logout', controller.logout);
    router.post('/register', controller.register);
    router.get('/users', controller.listUsers);
    router.get('/users/by-email/:email', controller.lookupByEmail);

    return router;
}
