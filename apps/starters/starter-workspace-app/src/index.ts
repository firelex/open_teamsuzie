import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { ApprovalQueue, InMemoryApprovalStore } from '@teamsuzie/approvals';
import { EventBus } from '@teamsuzie/events';
import { NullEmailClient, type EmailClient } from '@teamsuzie/email';

import { config } from './config.ts';
import { createPool, initSchema } from './db.ts';
import { AuditLog } from './audit.ts';
import { tenantContext } from './tenant.ts';
import { OidcClient } from './auth/OidcClient.ts';
import { SessionBundleRepo } from './auth/SessionBundleRepo.ts';
import { attachSession, requireSession } from './auth/middleware.ts';
import { authRouter } from './auth/routes.ts';
import { ConnectorRegistry } from './connectors.ts';

/**
 * The server context — the canonical full-stack plumbing every generated app
 * inherits: Postgres (multi-tenant), OAuth/OIDC auth, a tenant-scoped audit
 * trail, an in-memory event bus, approvals, email, and typed connectors. The
 * build agent reads from here (and registers connectors / mounts tenant-scoped
 * domain routers); it does not rebuild this wiring.
 */
const pool = createPool(config.databaseUrl);
await initSchema(pool, config.defaultTenantId);

const sessions = new SessionBundleRepo(pool, config.sessionSecret);
const oidc = new OidcClient(config.oidc);
const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
const audit = new AuditLog(pool);
const events = { bus: new EventBus() };
const email: EmailClient = new NullEmailClient();
const connectors = new ConnectorRegistry();

export const context = { pool, sessions, oidc, approvals, audit, events, email, connectors };

const app = express();
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Auth runs before the gate so /login, /callback, /logout, /me stay open.
app.use(attachSession(sessions, oidc));
app.use('/api/auth', authRouter({ oidc, sessions }));

// Everything else under /api requires a session and runs in a tenant scope.
app.use('/api', requireSession());
app.use('/api', tenantContext(config.defaultTenantId));
app.get('/api/me', (req, res) => res.json(req.user));
app.get('/api/connectors', (_req, res) => res.json({ connectors: connectors.list() }));
// The build agent mounts tenant-scoped domain routers here, e.g.:
//   app.use('/api/<resource>', <resource>Router(context));

// Serve the built client (client/dist) with SPA fallback in production.
const clientDist = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`[starter-workspace-app] server on http://localhost:${config.port}`);
});
