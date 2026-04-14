export interface AuthConfig {
    port: number;
    node_env: string;
    redis: { uri: string; key_prefix: string };
    postgres: { uri: string; logging?: boolean };
    cookie: { name: string; secret: string; domain?: string; maxAge?: number };
    csrf: { cookie_name: string };
    default_user_id: string;
    cors_origins: string[];
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
        : ['http://localhost:3008', 'http://localhost:5173'],
};

export default config;
