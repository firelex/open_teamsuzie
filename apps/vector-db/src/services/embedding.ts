import OpenAI from 'openai';
import config from '../config/index.js';
import { UsageTracker } from '@teamsuzie/usage-tracker';
import type { UsageService } from '@teamsuzie/usage-tracker';

const BATCH_SIZE = 10; // DashScope max texts per API call

export interface UsageContext {
    org_id?: string;
    user_id?: string;
    agent_id?: string;
}

export default class EmbeddingService {
    private client: OpenAI | null = null;
    private usageTracker: UsageTracker | null = null;

    constructor() {
        if (config.embedding.api_key) {
            this.client = new OpenAI({
                apiKey: config.embedding.api_key,
                baseURL: config.embedding.base_url
            });
        }

        if (config.usage_tracking) {
            this.usageTracker = new UsageTracker({
                redisUrl: config.redis_url
            });
        }
    }

    async generateEmbedding(text: string, context?: UsageContext): Promise<number[]> {
        if (!this.client) {
            throw new Error('Embedding client not configured. Set EMBEDDING_API_KEY.');
        }

        const response = await this.client.embeddings.create({
            model: config.embedding.model,
            input: text,
            dimensions: config.embedding.dimensions
        });

        await this.trackUsage(response.usage?.prompt_tokens || 0, context);

        return response.data[0].embedding;
    }

    async generateEmbeddings(texts: string[], context?: UsageContext): Promise<number[][]> {
        if (!this.client) {
            throw new Error('Embedding client not configured. Set EMBEDDING_API_KEY.');
        }

        const allEmbeddings: number[][] = [];
        let totalTokens = 0;

        // Process in batches of BATCH_SIZE
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const response = await this.client.embeddings.create({
                model: config.embedding.model,
                input: batch,
                dimensions: config.embedding.dimensions
            });

            allEmbeddings.push(...response.data.map(d => d.embedding));
            totalTokens += response.usage?.prompt_tokens || 0;
        }

        await this.trackUsage(totalTokens, context);

        return allEmbeddings;
    }

    isConfigured(): boolean {
        return this.client !== null;
    }

    private async trackUsage(inputTokens: number, context?: UsageContext): Promise<void> {
        if (!this.usageTracker || inputTokens === 0) return;

        try {
            await this.usageTracker.record({
                org_id: context?.org_id || '',
                user_id: context?.user_id || '',
                agent_id: context?.agent_id,
                service: config.embedding.provider as UsageService,
                operation: 'embeddings',
                model: config.embedding.model,
                input_units: inputTokens,
                output_units: 0
            });
        } catch (err) {
            console.error('[EmbeddingService] Failed to track usage:', err);
        }
    }
}
