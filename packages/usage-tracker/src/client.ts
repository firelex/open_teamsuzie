import { Redis } from 'ioredis';
import { UsageEvent, UsageTrackerConfig, calculateCost } from './types.js';

const DEFAULT_CHANNEL = 'usage:events';
const DEFAULT_KEY_PREFIX = 'usage:';

export class UsageTracker {
    private redis: Redis;
    private channel: string;
    private keyPrefix: string;
    private connected: boolean = false;

    constructor(config: UsageTrackerConfig) {
        this.redis = new Redis(config.redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times: number) => Math.min(times * 100, 3000),
        });
        this.channel = config.channel || DEFAULT_CHANNEL;
        this.keyPrefix = config.keyPrefix || DEFAULT_KEY_PREFIX;

        this.redis.on('connect', () => {
            this.connected = true;
        });

        this.redis.on('error', (err: Error) => {
            console.error('[UsageTracker] Redis error:', err.message);
        });
    }

    /**
     * Record a usage event
     * Publishes to Redis pub/sub for async processing
     */
    async record(event: UsageEvent): Promise<void> {
        const fullEvent = {
            ...event,
            timestamp: event.timestamp || new Date(),
            cost_estimate: event.cost_estimate ?? calculateCost(event),
        };

        try {
            await this.redis.publish(this.channel, JSON.stringify(fullEvent));
        } catch (error) {
            // Non-blocking - log error but don't throw
            console.error('[UsageTracker] Failed to record usage:', error);
        }
    }

    /**
     * Record multiple usage events
     */
    async recordBatch(events: UsageEvent[]): Promise<void> {
        const pipeline = this.redis.pipeline();

        for (const event of events) {
            const fullEvent = {
                ...event,
                timestamp: event.timestamp || new Date(),
                cost_estimate: event.cost_estimate ?? calculateCost(event),
            };
            pipeline.publish(this.channel, JSON.stringify(fullEvent));
        }

        try {
            await pipeline.exec();
        } catch (error) {
            console.error('[UsageTracker] Failed to record batch usage:', error);
        }
    }

    /**
     * Subscribe to usage events (for consumers)
     */
    async subscribe(callback: (event: UsageEvent) => void | Promise<void>): Promise<void> {
        const subscriber = this.redis.duplicate();

        await subscriber.subscribe(this.channel);

        subscriber.on('message', async (channel: string, message: string) => {
            if (channel === this.channel) {
                try {
                    const event = JSON.parse(message) as UsageEvent;
                    await callback(event);
                } catch (error) {
                    console.error('[UsageTracker] Failed to process event:', error);
                }
            }
        });
    }

    /**
     * Close Redis connection
     */
    async close(): Promise<void> {
        await this.redis.quit();
        this.connected = false;
    }

    /**
     * Check if connected to Redis
     */
    isConnected(): boolean {
        return this.connected;
    }
}
