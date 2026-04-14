import session from 'express-session';
import { RedisStore } from 'connect-redis';
import type { Express } from 'express';
import RedisService from './redis.js';
import type { SharedAuthConfig } from '../types.js';

export default class SessionService {

    private redisService: RedisService;
    private config: SharedAuthConfig;
    private middleware: any = null;

    constructor(config: SharedAuthConfig) {
        this.config = config;
        this.redisService = new RedisService(config);
    }

    private createMiddleware() {
        const redisClient = this.redisService.getClient();

        const store = new RedisStore({
            client: redisClient,
            prefix: `${this.config.redis.key_prefix}:session:`
        });

        return (session as any)({
            store: store,
            secret: this.config.cookie.secret,
            name: this.config.cookie.name,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: this.config.node_env !== 'development',
                httpOnly: true,
                maxAge: this.config.cookie.maxAge,
                domain: this.config.cookie.domain || undefined,
                sameSite: 'strict' as const
            }
        });
    }

    init(app: Express) {
        this.middleware = this.createMiddleware();
        app.use(this.middleware);
        console.log('[SESSION] Session middleware initialized with Redis store');
    }

    /** Get the session middleware function (for use outside Express, e.g. WebSocket upgrades) */
    getMiddleware() {
        if (!this.middleware) {
            this.middleware = this.createMiddleware();
        }
        return this.middleware;
    }
}
