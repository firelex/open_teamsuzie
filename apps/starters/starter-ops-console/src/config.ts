import type { SharedAuthConfig } from '@teamsuzie/shared-auth';

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

const port = parseInt(process.env.STARTER_OPS_PORT || '18311', 10);

export const config = {
  port,
  publicUrl: (process.env.STARTER_OPS_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  allowedOrigin: process.env.STARTER_OPS_ALLOWED_ORIGIN || 'http://localhost:18276',
  title: process.env.STARTER_OPS_TITLE || 'Team Suzie',
  nodeEnv: process.env.NODE_ENV || 'development',
  approvals: {
    enabled: boolEnv(process.env.STARTER_OPS_APPROVALS_ENABLED, true),
  },
  demo: {
    email: process.env.DEMO_EMAIL || 'demo@example.com',
    password: process.env.DEMO_PASSWORD || 'demo12345',
    name: process.env.DEMO_NAME || 'Demo User',
  },
  agent: {
    name: process.env.STARTER_OPS_AGENT_NAME || 'Suzie',
    baseUrl: (process.env.STARTER_OPS_AGENT_BASE_URL || 'http://localhost:4000').replace(/\/$/, ''),
    apiKey: process.env.STARTER_OPS_AGENT_API_KEY || undefined,
    model: process.env.STARTER_OPS_MODEL || 'openai/gpt-4.1-mini',
  },
};

export const sharedAuthConfig: SharedAuthConfig = {
  node_env: process.env.NODE_ENV || 'development',
  redis: {
    uri: process.env.REDIS_URI || 'redis://localhost:6379/0',
    key_prefix: process.env.REDIS_KEY_PREFIX || 'starter-ops-console',
  },
  postgres: {
    uri:
      process.env.POSTGRES_URI ||
      'postgres://teamsuzie:teamsuzie@localhost:5432/teamsuzie',
    logging: !!process.env.POSTGRES_ENABLE_LOGGING,
  },
  cookie: {
    name: process.env.COOKIE_NAME || 'starter-ops.sid',
    secret: process.env.COOKIE_SECRET || 'dev-only-ops-console-secret',
    domain: process.env.COOKIE_DOMAIN,
    maxAge: Number(process.env.COOKIE_MAXAGE) || 31 * 24 * 60 * 60 * 1000,
  },
  csrf: {
    cookie_name: process.env.CSRF_COOKIE_NAME || 'DEV-CSRF-TOKEN',
  },
  default_user_id: process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000',
  // A starter to try things out locally: anyone may sign up.
  allow_registration: true,
};
