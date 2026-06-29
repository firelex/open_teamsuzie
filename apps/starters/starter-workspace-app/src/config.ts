import { randomBytes } from 'node:crypto';

/** Server config, all overridable via env. The build agent rarely touches this. */
export const config = {
  port: parseInt(process.env.PORT || '5211', 10),
  /** Origin of the Vite client dev server, for CORS + post-login redirect. */
  webOrigin: (process.env.WEB_ORIGIN || 'http://localhost:5273').replace(/\/$/, ''),
  dbPath: process.env.DB_PATH || './data/app.db',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL || 'http://localhost:3005',
    clientId: process.env.OIDC_CLIENT_ID || 'starter-workspace-app',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    redirectUri: process.env.OIDC_REDIRECT_URI || 'http://localhost:5211/api/auth/callback',
    resource: process.env.OIDC_RESOURCE || 'http://localhost:5211',
  },
};
