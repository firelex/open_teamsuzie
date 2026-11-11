import { parseRegistrationPolicy, type RegistrationPolicy } from '@teamsuzie/shared-auth';

export interface AuthConfig {
    port: number;
    node_env: string;
    redis: { uri: string; key_prefix: string };
    postgres: { uri: string; logging?: boolean };
    cookie: { name: string; secret: string; domain?: string; maxAge?: number };
    csrf: { cookie_name: string };
    default_user_id: string;
    cors_origins: string[];
    oidc: { issuer: string; jwkPath: string };
    /** AUTH_REGISTRATION / AUTH_REGISTRATION_DOMAINS: closed unless set. */
    registration: RegistrationPolicy;
    /** Limits on sign-in and on registration attempts, each counted per client address and per email. */
    rate_limit: { window_ms: number; max_per_ip: number; max_per_account: number };
    /** Express 'trust proxy': set it behind a reverse proxy so the client address is the real one, not the proxy's. */
    trust_proxy: boolean | number | string | undefined;
}

function positiveInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive whole number (got '${raw}')`);
    return value;
}

/** AUTH_TRUST_PROXY: 'true' / 'false', a hop count, or addresses / subnets as Express accepts them. */
function trustProxy(raw: string | undefined): boolean | number | string | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
}

const config: AuthConfig = {
    port: Number(process.env.PORT) || 3005,
    node_env: process.env.NODE_ENV || 'development',
    redis: {
        uri: process.env.REDIS_URI || process.env.REDIS_URL || 'redis://localhost:6379/0',
        key_prefix: process.env.REDIS_KEY_PREFIX || 'teamsuzie-auth',
    },
    postgres: {
        uri: process.env.POSTGRES_URI || `postgres://${process.env.DB_USER || 'teamsuzie'}:${process.env.DB_PASSWORD || 'teamsuzie'}@localhost:5432/${process.env.DB_NAME || 'teamsuzie'}`,
        logging: !!process.env.POSTGRES_ENABLE_LOGGING,
    },
    cookie: {
        name: process.env.COOKIE_NAME || 'teamsuzie.sid',
        secret: process.env.COOKIE_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('COOKIE_SECRET environment variable is required in production'); })() as never : 'dev-only-cookie-secret'),
        domain: process.env.COOKIE_DOMAIN,
        maxAge: Number(process.env.COOKIE_MAXAGE) || 31 * 24 * 60 * 60 * 1000, // 31 days
    },
    csrf: {
        cookie_name: process.env.CSRF_COOKIE_NAME || 'DEV-CSRF-TOKEN',
    },
    default_user_id: process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000',
    cors_origins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
        : ['http://localhost:3008', 'http://localhost:5173', 'http://localhost:5174'],
    oidc: {
        issuer: process.env.OIDC_ISSUER_URL ?? `http://localhost:${process.env.PORT ?? 3005}`,
        jwkPath: process.env.OIDC_SIGNING_KEY_PATH ?? './data/oidc/keys.json',
    },
    registration: parseRegistrationPolicy(process.env),
    rate_limit: {
        window_ms: positiveInt('AUTH_RATE_LIMIT_WINDOW_MS', 60_000),
        max_per_ip: positiveInt('AUTH_RATE_LIMIT_MAX_PER_IP', 10),
        max_per_account: positiveInt('AUTH_RATE_LIMIT_MAX_PER_ACCOUNT', 10),
    },
    trust_proxy: trustProxy(process.env.AUTH_TRUST_PROXY),
};

export default config;
