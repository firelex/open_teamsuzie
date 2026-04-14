import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config/index.js';
import {
    SequelizeService, SessionService, CsrfMiddleware,
    User, Organization, OrganizationMember, Agent, AgentProfile,
    createAuthRouter,
    type SharedAuthConfig
} from '@teamsuzie/shared-auth';
import type { ModelCtor } from 'sequelize-typescript';

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
app.use(helmet());
app.use(cors({
    origin: config.cors_origins,
    credentials: true,
}));
app.use(express.json());

// Initialize database with all auth models
type ModelWithAssociate = ModelCtor & { associate: (models: unknown) => void };
const migrationsPath = path.join(__dirname, 'migrations/sequelize');
const sequelizeService = new SequelizeService(
    sharedAuthConfig,
    [User, Organization, OrganizationMember, AgentProfile, Agent] as ModelWithAssociate[],
    migrationsPath
);
await sequelizeService.init(true);

// Initialize sessions
const sessionService = new SessionService(sharedAuthConfig);
sessionService.init(app);

// CSRF protection
const csrfMiddleware = new CsrfMiddleware(sharedAuthConfig);
app.use(csrfMiddleware.checkCsrf);

// Auth routes (login, logout, register, me, users)
app.use(createAuthRouter(sharedAuthConfig));

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

// Start server
app.listen(config.port, () => {
    console.log(`Auth service running on port ${config.port}`);
});
