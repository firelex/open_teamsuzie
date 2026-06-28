import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config/index.js';
import {
    SequelizeService, SessionService, CsrfMiddleware,
    User, Organization, OrganizationMember, Agent, AgentProfile, UserAccessToken,
    createAuthRouter,
    createRequestId,
    UserService,
    type SharedAuthConfig
} from '@teamsuzie/shared-auth';
import type { ModelCtor } from 'sequelize-typescript';
import { buildOidcProvider } from './oidc/Provider.js';
import { buildInteractionsRouter } from './oidc/interactions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Build shared auth config
const sharedAuthConfig: SharedAuthConfig = {
    node_env: config.node_env,
    redis: config.redis,
    postgres: config.postgres,
    cookie: config.cookie,
    csrf: config.csrf,
    default_user_id: config.default_user_id,
};

// Middleware
app.use(createRequestId());
app.use(helmet());
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
    [User, Organization, OrganizationMember, AgentProfile, Agent, UserAccessToken] as ModelWithAssociate[],
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
app.use(buildInteractionsRouter(provider, verifyUserPassword));

const csrfMiddleware = new CsrfMiddleware(sharedAuthConfig);

// Auth routes (mounted at both / and /auth for client convenience)
const authRouter = createAuthRouter(sharedAuthConfig);
app.use('/api/auth', csrfMiddleware.checkCsrf, authRouter);
app.use('/auth', csrfMiddleware.checkCsrf, authRouter);

app.use(express.static(path.join(__dirname, '../public')));

// Config endpoint for clients
app.get('/config', (_req, res) => {
    res.json({
        csrf_cookie_name: config.csrf.cookie_name,
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
