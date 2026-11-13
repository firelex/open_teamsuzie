import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SequelizeService,
  SessionService,
  createAuthRouter,
  createRequestId,
  User,
  Organization,
  OrganizationMember,
  AgentProfile,
  Agent,
  OrgDomain,
  ensureUserAdminSchema,
} from '@teamsuzie/shared-auth';
import type { ModelCtor } from 'sequelize-typescript';
import { config, sharedAuthConfig } from './config.js';
import { Contact } from './models/contact.js';
import { createApprovalQueue } from './services/approvals.js';
import { ensureSeed } from './services/seed.js';
import { printStartupError } from './services/startup-errors.js';
import { createContactsRouter } from './routes/contacts.js';
import { createUsersRouter } from './routes/users.js';
import { createApprovalsRouter } from './routes/approvals.js';
import { createExportRouter } from './routes/export.js';
import { getSession } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, '../client/dist');

async function main() {
  const app = express();
  app.use(createRequestId());
  app.use(cors({ origin: config.allowedOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  // Initialize postgres. We register the shared-auth models alongside our
  // Contact model so `sync()` creates both sets in one pass.
  type ModelWithAssociate = ModelCtor & { associate: (models: unknown) => void };
  const sequelizeService = new SequelizeService(
    sharedAuthConfig,
    [User, Organization, OrganizationMember, AgentProfile, Agent, OrgDomain, Contact] as ModelWithAssociate[],
  );

  try {
    await sequelizeService.getSequelize().authenticate();
    await sequelizeService.getSequelize().sync();
    // sync() never adds a column to an existing table; this adds the user columns shared-auth reads now.
    await ensureUserAdminSchema(sequelizeService.getSequelize());
    console.log('[DB] Schema synced (users + organizations + contacts)');
  } catch (err) {
    printStartupError(err);
    process.exit(1);
  }

  // Auto-seed in development so `pnpm dev` is the only command needed
  // after `pnpm docker:up`. Idempotent — skipped entirely in production.
  if (config.nodeEnv === 'development') {
    try {
      const summary = await ensureSeed();
      if (summary.created) {
        console.log('[seed] created demo data');
        console.log(`  admin login: ${summary.adminEmail} / ${summary.adminPassword}`);
        console.log(`  demo login:  ${summary.demoEmail} / ${summary.demoPassword}`);
      }
    } catch (err) {
      console.warn('[seed] skipped — will retry on next boot');
      console.warn(`  reason: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Session middleware (Redis-backed).
  const sessionService = new SessionService(sharedAuthConfig);
  sessionService.init(app);

  // Approval queue for destructive actions.
  const queue = createApprovalQueue();

  // Health endpoint — open, surfaces feature flags + (dev-only) demo creds
  // so the login page can show them as a one-click onboarding hint.
  app.get('/api/health', (_req, res) => {
    const demo =
      config.nodeEnv === 'development'
        ? { email: config.demo.email, password: config.demo.password }
        : undefined;

    res.json({
      status: 'ok',
      title: config.title,
      approvalsEnabled: config.approvals.enabled,
      demo,
    });
  });

  // Auth: /api/auth/login, /api/auth/register, /api/auth/logout, /api/auth/me.
  app.use('/api/auth', createAuthRouter(sharedAuthConfig));

  // Session info for the client.
  app.get('/api/session', (req, res) => {
    const session = getSession(req);
    if (!session.userId) {
      res.json({ user: null });
      return;
    }
    res.json({
      user: {
        id: session.userId,
        email: session.userEmail,
        name: session.userName,
        role: session.userRole,
      },
    });
  });

  app.use('/api/contacts', createContactsRouter({ queue }));
  app.use('/api/users', createUsersRouter());
  app.use('/api/approvals', createApprovalsRouter({ queue }));
  app.use('/api/export', createExportRouter());

  app.use(express.static(clientDistDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistDir, 'index.html'), (error) => {
      if (error) next();
    });
  });

  app.listen(config.port, () => {
    console.log(`Starter ops console listening on ${config.publicUrl}`);
    console.log(`  approvals: ${config.approvals.enabled ? 'on (destructive actions gated)' : 'off (bypass)'}`);
    if (config.nodeEnv === 'development') {
      console.log(`  open http://localhost:${config.port === 18311 ? 18276 : config.port} and sign in with demo creds shown on the login page`);
    }
  });
}

void main();
