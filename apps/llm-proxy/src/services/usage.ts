// eslint-disable-next-line @typescript-eslint/no-require-imports
import IORedis from 'ioredis';

const USAGE_CHANNEL = 'usage:events';

// ioredis ESM/CJS interop: the default export may be the class or a module wrapper
const RedisConstructor = (IORedis as any).default ?? IORedis;
let redis: any = null;

export function initUsagePublisher(redisUrl: string): void {
    redis = new RedisConstructor(redisUrl);
    redis.on('error', (err: Error) => {
        console.error('[LLM-PROXY] Redis error:', err.message);
    });
    console.log('[LLM-PROXY] Usage publisher connected to Redis');
}

export interface UsageEventPayload {
    service: string;
    operation: string;
    model: string;
    input_units: number;
    output_units: number;
    timestamp: string;
    metadata: {
        request_id?: string;
        user_api_key_hash: string;
        cached_tokens?: number;
        cache_creation_tokens?: number;
    };
}

/**
 * Publish a usage event to Redis pub/sub.
 * Uses the existing shared usage channel and schema.
 */
export async function publishUsage(event: UsageEventPayload): Promise<void> {
    if (!redis) {
        console.warn('[LLM-PROXY] Usage publisher not initialized, dropping event');
        return;
    }

    try {
        await redis.publish(USAGE_CHANNEL, JSON.stringify(event));
    } catch (err: any) {
        console.error('[LLM-PROXY] Failed to publish usage event:', err.message);
    }
}

export async function closeUsagePublisher(): Promise<void> {
    if (redis) {
        await redis.quit();
        redis = null;
    }
}
