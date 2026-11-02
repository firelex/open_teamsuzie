import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config/index.js';
import {
    SequelizeService, SessionService, CsrfMiddleware,
    User, Organization, OrganizationMember, OrgDomain, Agent, AgentProfile, UserAccessToken,
    createAuthRouter,
    createRequestId,
    UserService,
    type SharedAuthConfig
} from '@teamsuzie/shared-auth';
import type { ModelCtor } from 'sequelize-typescript';
import { buildOidcProvider } from './oidc/Provider.js';
import { buildInteractionsRouter } from './oidc/interactions.js';
import { loadClientRegistry } from './oidc/clients.js';
import { AttemptLimiter, limitAttempts } from './security/attempt-limiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
if (config.trust_proxy !== undefined) {
    app.set('trust proxy', config.trust_proxy);
} else if (config.node_env === 'production') {
    console.warn('[WARN] AUTH_TRUST_PROXY is not set: behind a reverse proxy every client has the proxy\'s address, '
        + 'so they all share one sign-in rate limit. Set it to the number of proxies in front of this service.');
}

// Build shared auth config
const sharedAuthConfig: SharedAuthConfig = {
    node_env: config.node_env,
    redis: config.redis,
    postgres: config.postgres,
    cookie: config.cookie,
    csrf: config.csrf,
    default_user_id: config.default_user_id,
    registration: config.registration,
};

// Middleware
app.use(createRequestId());
// The sign-in form's POST ends in a redirect to the client's callback, and browsers apply form-action to every hop,
// so helmet's default form-action 'self' blocks the return to the client. Allow the registered redirect origins too.
const clientRedirectOrigins = [...new Set(
    loadClientRegistry(process.env).flatMap(c => c.redirect_uris).map(u => new URL(u).origin)
)];
app.use(helmet({
    contentSecurityPolicy: {
        directives: { formAction: ["'self'", ...clientRedirectOrigins] },
    },
}));
app.use(cors({
    origin: config.cors_origins,
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Initialize database with all auth models
type ModelWithAssociate = ModelCtor & { associate: (models: unknown) => void };
const migrationsPath = path.join(__dirname, 'migrations/sequelize');
const sequelizeService = new SequelizeService(
    sharedAuthConfig,
    [User, Organization, OrganizationMember, OrgDomain, AgentProfile, Agent, UserAccessToken] as ModelWithAssociate[],
    migrationsPath
);
await sequelizeService.init(true);

// Initialize sessions
const sessionService = new SessionService(sharedAuthConfig);
sessionService.init(app);

const userService = new UserService(sharedAuthConfig);
const verifyUserPassword = async (email: string, password: string) => {
    const user = await userService.authenticate(email, password);
    return user ? { id: user.id } : null;
};
const provider = await buildOidcProvider({
    issuer: config.oidc.issuer,
    jwkPath: config.oidc.jwkPath,
    sequelize: sequelizeService.getSequelize() as unknown as import('sequelize').Sequelize,
});
provider.proxy = true;
// Sign-in attempts (the OIDC sign-in page and the JSON routes share one count) and registration attempts.
const limiterOptions = {
    windowMs: config.rate_limit.window_ms,
    maxPerIp: config.rate_limit.max_per_ip,
    maxPerAccount: config.rate_limit.max_per_account,
};
const signInLimiter = new AttemptLimiter(limiterOptions);
const registerLimiter = new AttemptLimiter(limiterOptions);
app.use(buildInteractionsRouter(provider, verifyUserPassword, {
    registration: config.registration.mode,
    limiter: signInLimiter,
}));

const csrfMiddleware = new CsrfMiddleware(sharedAuthConfig);

// Auth routes (mounted at both / and /auth for client convenience)
const authRouter = createAuthRouter(sharedAuthConfig);
app.post(['/api/auth/login', '/auth/login'], limitAttempts(signInLimiter, { releaseOnSuccess: true }));
app.post(['/api/auth/register', '/auth/register'], limitAttempts(registerLimiter, { releaseOnSuccess: false }));
app.use('/api/auth', csrfMiddleware.checkCsrf, authRouter);
app.use('/auth', csrfMiddleware.checkCsrf, authRouter);

app.use(express.static(path.join(__dirname, '../public')));

// Config endpoint for clients
app.get('/config', (_req, res) => {
    res.json({
        csrf_cookie_name: config.csrf.cookie_name,
        // Lets a client hide or show its sign-up form. The domain list itself is not published.
        registration: config.registration.mode,
    });
});

// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'auth',
        port: config.port,
        timestamp: new Date().toISOString()
    });
});

app.use(provider.callback());

// Start server
app.listen(config.port, () => {
    console.log(`Auth service running on port ${config.port}`);
});
