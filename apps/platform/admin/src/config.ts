import type { SharedAuthConfig } from '@teamsuzie/shared-auth';

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  baseUrl: string;
  apiKey?: string;
  openclawAgentId?: string;
}

function parseAgents(raw: string | undefined): AgentConfig[] {
  if (!raw?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('CHAT_AGENTS must be a JSON array');
    }

    return parsed.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`CHAT_AGENTS[${index}] must be an object`);
      }

      const candidate = item as Record<string, unknown>;
      const id = String(candidate.id ?? '').trim();
      const name = String(candidate.name ?? '').trim();
      const baseUrl = String(candidate.baseUrl ?? '').trim().replace(/\/$/, '');

      if (!id || !name || !baseUrl) {
        throw new Error(`CHAT_AGENTS[${index}] requires id, name, and baseUrl`);
      }

      return {
        id,
        name,
        description: typeof candidate.description === 'string' ? candidate.description : undefined,
        baseUrl,
        apiKey: typeof candidate.apiKey === 'string' ? candidate.apiKey : undefined,
        openclawAgentId:
          typeof candidate.openclawAgentId === 'string' ? candidate.openclawAgentId : undefined,
      };
    });
  } catch (error) {
    throw new Error(
      `Failed to parse CHAT_AGENTS: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

const port = parseInt(process.env.ADMIN_PORT || '3008', 10);

export const config = {
  port,
  publicUrl: (process.env.ADMIN_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  allowedOrigin: process.env.ADMIN_ALLOWED_ORIGIN || 'http://localhost:5175',
  title: process.env.ADMIN_TITLE || 'Team Suzie Admin',
  nodeEnv: process.env.NODE_ENV || 'development',
  agents: parseAgents(process.env.CHAT_AGENTS),
  demo: {
    email: process.env.DEMO_EMAIL || 'demo@example.com',
    password: process.env.DEMO_PASSWORD || 'demo12345',
    name: process.env.DEMO_NAME || 'Demo User',
  },
  seed: {
    email: process.env.SEED_EMAIL || 'admin@example.com',
    password: process.env.SEED_PASSWORD || 'admin12345',
    name: process.env.SEED_NAME || 'Admin',
  },
  // Master secret used to encrypt config_value.value_encrypted. In dev it
  // falls back to COOKIE_SECRET so a single-secret .env keeps working; in
  // prod it must be explicitly set.
  configSecret:
    process.env.CONFIG_SECRET ||
    process.env.COOKIE_SECRET ||
    'dev-only-config-secret',
};

export const sharedAuthConfig: SharedAuthConfig = {
  node_env: process.env.NODE_ENV || 'development',
  redis: {
    uri: process.env.REDIS_URI || 'redis://localhost:6379/0',
    key_prefix: process.env.REDIS_KEY_PREFIX || 'admin',
  },
  postgres: {
    uri:
      process.env.POSTGRES_URI ||
      'postgres://teamsuzie:teamsuzie@localhost:5432/teamsuzie',
    logging: !!process.env.POSTGRES_ENABLE_LOGGING,
  },
  cookie: {
    name: process.env.COOKIE_NAME || 'admin.sid',
    secret: process.env.COOKIE_SECRET || 'dev-only-admin-secret',
    domain: process.env.COOKIE_DOMAIN,
    maxAge: Number(process.env.COOKIE_MAXAGE) || 31 * 24 * 60 * 60 * 1000,
  },
  csrf: {
    cookie_name: process.env.CSRF_COOKIE_NAME || 'DEV-CSRF-TOKEN',
  },
  default_user_id: process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000',
  allow_registration: process.env.AUTH_ALLOW_REGISTRATION === 'true',
};
