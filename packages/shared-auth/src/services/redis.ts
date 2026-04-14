import { Redis, type RedisOptions } from 'ioredis';
import type { SharedAuthConfig } from '../types.js';

export default class RedisService {

    private redis: Redis;
    private keyPrefix: string;

    constructor(config: SharedAuthConfig, options: RedisOptions = {}) {
        this.redis = new Redis(config.redis.uri, options);
        this.keyPrefix = config.redis.key_prefix;

        this.redis.on('error', (err: Error) => {
            console.error('[REDIS] Could not connect to redis:', err.message);
        });

        this.redis.on('connect', () => {
            console.log('[REDIS] Connected to redis');
        });
    }

    getClient = () => {
        return this.redis;
    }

    get = (key: string, isGlobal = false) => {
        return new Promise((resolve, reject) => {
            const _key = isGlobal ? key : `${this.keyPrefix}:${key}`;
            this.redis.get(_key, (err, value) => {
                if (err) return reject(err);
                resolve(value);
            });
        });
    }

    set = async (key: string, value: string | number, ttl?: number, isGlobal = false) => {
        const _key = isGlobal ? key : `${this.keyPrefix}:${key}`;
        await this.redis.set(_key, value);
        if (ttl) {
            await this.redis.pexpire(_key, ttl);
        }
        return value;
    }

    delete = async (key: string, isGlobal = false) => {
        const _key = isGlobal ? key : `${this.keyPrefix}:${key}`;
        const value = await this.redis.get(_key);
        await this.redis.del(_key);
        return value;
    }
}
