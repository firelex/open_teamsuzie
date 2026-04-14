import Tokens from 'csrf';
import type { CookieOptions, NextFunction, Response, Request } from 'express';
import type { SharedAuthConfig } from '../types.js';

export default class CsrfMiddleware {

    private tokens: Tokens;
    private config: SharedAuthConfig;
    private excludedEndpoints: string[];

    constructor(config: SharedAuthConfig, excludedEndpoints: string[] = []) {
        this.tokens = new Tokens();
        this.config = config;
        this.excludedEndpoints = excludedEndpoints;
    }

    isDevEnvAuth(req: Request): boolean {
        const authEndpoints = ['/api/auth/login', '/api/auth/register'];
        return authEndpoints.some(ep => req.originalUrl === ep) &&
            req.method === 'POST' &&
            this.config.node_env === 'development';
    }

    checkCsrf = (req: Request, res: Response, next: NextFunction): void => {

        // Where token auth is used explicitly, continue.
        // API clients often send `X-API-Key` instead of `Authorization`.
        const hasAuthorizationHeader = !!req.headers?.authorization?.length;
        const hasApiKeyHeader = !!req.headers?.['x-api-key'];
        if (hasAuthorizationHeader || hasApiKeyHeader) {
            return next();
        }

        // Check excluded endpoints first (before session check)
        const isExcludedEndpoint = this.excludedEndpoints.some(ep => req.originalUrl.startsWith(ep));
        if (isExcludedEndpoint) {
            return next();
        }

        if (!req.session) {
            res.status(500).json({ error: 'Session not initialized' });
            return;
        }

        if (!(req.session as any).csrf_secret) {
            (req.session as any).csrf_secret = this.tokens.secretSync();
        }

        const isDevEnv = this.config.node_env === 'development' || this.config.node_env === 'test';

        const cookieOptions: CookieOptions = {
            domain: !isDevEnv ? this.config.cookie.domain : undefined,
            secure: !isDevEnv,
            httpOnly: false,  // CSRF token must be readable by client JavaScript
            path: '/',
            sameSite: 'strict'
        };

        const unProtectedMethods = ['OPTIONS', 'GET', 'HEAD', 'TRACE'];
        const isUnProtectedMethod: boolean = unProtectedMethods.includes(req.method);

        const csrfSecret = (req.session as any).csrf_secret;
        const token = this.tokens.create(csrfSecret);
        res.cookie(this.config.csrf.cookie_name, token, cookieOptions);

        if (isUnProtectedMethod || this.isDevEnvAuth(req)) {
            return next();
        }

        const submittedCsrf = req.body?.csrf_token || req.headers['x-csrf-token'];

        if (!this.tokens.verify(csrfSecret, submittedCsrf as string)) {
            res.status(403).json({ error: 'Invalid CSRF token' });
            return;
        }

        next();
    }
}
