import { randomBytes } from 'node:crypto';

/** Server config, all overridable via env. The build agent rarely touches this. */
export const config = {
  port: parseInt(process.env.PORT || '5211', 10),
  /** Origin of the Vite client dev server, for CORS + post-login redirect. */
  webOrigin: (process.env.WEB_ORIGIN || 'http://localhost:5273').replace(/\/$/, ''),
  /** Authoritative tenant store. Postgres — multi-tenant, row-scoped by tenant_id. */
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/workspace_app',
  /** Tenant used when an app hasn't wired real tenant resolution yet (single-tenant dev). */
  defaultTenantId: process.env.DEFAULT_TENANT_ID || 'default',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL || 'http://localhost:3005',
    clientId: process.env.OIDC_CLIENT_ID || 'starter-workspace-app',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    redirectUri: process.env.OIDC_REDIRECT_URI || 'http://localhost:5211/api/auth/callback',
    // Default UNSET: a browser sign-in app needs no RFC 8707 resource indicator,
    // and apps/auth rejects an unregistered one with `invalid_target`. Set only
    // to a resource apps/auth registers, when a resource-bound JWT is needed.
    resource: process.env.OIDC_RESOURCE || '',
  },
};
