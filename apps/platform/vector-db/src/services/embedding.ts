import config from '../config/index.js';
import { UsageTracker } from '@teamsuzie/usage-tracker';
import type { UsageService } from '@teamsuzie/usage-tracker';

const DATA_URL_RE = /^data:[^;]+;base64,/i;

export interface UsageContext {
    org_id?: string;
    user_id?: string;
    agent_id?: string;
}

export type EmbeddingRuntime = 'openai-compatible' | 'llama.cpp';
export type EmbeddingModality = 'text' | 'multimodal';

export interface EmbeddingProfile {
    id: string;
    runtime: EmbeddingRuntime;
    modality: EmbeddingModality;
    model: string;
    dimensions: number;
    baseUrl: string;
    apiKey?: string;
    provider: string;
    includeDimensions?: boolean;
    batchSize: number;
    llamaCpp?: {
        endpoint: string;
        mediaMarker: string;
        embdNormalize?: number;
    };
}

export interface EmbeddingInput {
    text: string;
    mediaBase64?: string[];
}

interface Embedder {
    readonly profile: EmbeddingProfile;
    isConfigured(): boolean;
    embed(inputs: EmbeddingInput[]): Promise<number[][]>;
}

export default class EmbeddingService {
    private embedder: Embedder;
    private usageTracker: UsageTracker | null = null;

    constructor() {
        const profile = defaultProfile();
        this.embedder = profile.runtime === 'llama.cpp'
            ? new LlamaCppMultimodalEmbedder(profile)
            : new OpenAICompatibleTextEmbedder(profile);

        if (config.usage_tracking) {
            this.usageTracker = new UsageTracker({
                redisUrl: config.redis_url
            });
        }
    }

    profile(): EmbeddingProfile {
        return this.embedder.profile;
    }

    isConfigured(profileId?: string): boolean {
        return this.profileMatches(profileId) && this.embedder.isConfigured();
    }

    async generateEmbedding(input: string | EmbeddingInput, context?: UsageContext, profileId?: string): Promise<number[]> {
        const embeddings = await this.generateEmbeddings([normalizeInput(input)], context, profileId);
        return embeddings[0];
    }

    async generateEmbeddings(inputs: Array<string | EmbeddingInput>, context?: UsageContext, profileId?: string): Promise<number[][]> {
        if (!this.profileMatches(profileId)) {
            throw new Error(`Embedding profile not available: ${profileId}. Active profile is ${this.embedder.profile.id}.`);
        }
        if (!this.embedder.isConfigured()) {
            throw new Error('Embedding client not configured. Set EMBEDDING_API_KEY or configure a llama.cpp embedding endpoint.');
        }

        const normalized = inputs.map(normalizeInput);
        const embeddings = await this.embedder.embed(normalized);
        await this.trackUsage(estimateInputUnits(normalized), context);
        return embeddings;
    }

    private profileMatches(profileId?: string): boolean {
        return !profileId || profileId === this.embedder.profile.id;
    }

    private async trackUsage(inputUnits: number, context?: UsageContext): Promise<void> {
        if (!this.usageTracker || inputUnits === 0) return;

        try {
            await this.usageTracker.record({
                org_id: context?.org_id || '',
                user_id: context?.user_id || '',
                agent_id: context?.agent_id,
                service: this.embedder.profile.provider as UsageService,
                operation: 'embeddings',
                model: this.embedder.profile.model,
                input_units: inputUnits,
                output_units: 0
            });
        } catch (err) {
            console.error('[EmbeddingService] Failed to track usage:', err);
        }
    }
}

class OpenAICompatibleTextEmbedder implements Embedder {
    constructor(readonly profile: EmbeddingProfile) {}

    isConfigured(): boolean {
        return Boolean(this.profile.apiKey || this.profile.baseUrl.startsWith('http://localhost') || this.profile.baseUrl.startsWith('http://127.0.0.1'));
    }

    async embed(inputs: EmbeddingInput[]): Promise<number[][]> {
        for (const input of inputs) {
            if (input.mediaBase64?.length) {
                throw new Error(`Embedding profile ${this.profile.id} is text-only; media input requires a multimodal profile.`);
            }
        }

        const out: number[][] = [];
        for (let i = 0; i < inputs.length; i += this.profile.batchSize) {
            const batch = inputs.slice(i, i + this.profile.batchSize);
            const body: Record<string, unknown> = {
                model: this.profile.model,
                input: batch.map((input) => input.text)
            };
            if (this.profile.includeDimensions) body.dimensions = this.profile.dimensions;

            const response = await fetchJson(`${trimSlash(this.profile.baseUrl)}/embeddings`, body, this.profile.apiKey);
            const vectors = parseOpenAIEmbeddingsResponse(response);
            validateDimensions(vectors, this.profile);
            out.push(...vectors);
        }
        return out;
    }
}

class LlamaCppMultimodalEmbedder implements Embedder {
    constructor(readonly profile: EmbeddingProfile) {}

    isConfigured(): boolean {
        return Boolean(this.profile.baseUrl);
    }

    async embed(inputs: EmbeddingInput[]): Promise<number[][]> {
        const out: number[][] = [];
        for (const input of inputs) {
            const body: Record<string, unknown> = {
                content: contentForLlamaCpp(input, this.profile),
                encoding_format: 'float'
            };
            if (this.profile.llamaCpp?.embdNormalize !== undefined) {
                body.embd_normalize = this.profile.llamaCpp.embdNormalize;
            }

            const endpoint = this.profile.llamaCpp?.endpoint || '/embedding';
            const response = await fetchJson(`${trimSlash(this.profile.baseUrl)}${endpoint}`, body, this.profile.apiKey);
            const vectors = parseLlamaCppEmbeddingsResponse(response);
            validateDimensions(vectors, this.profile);
            out.push(...vectors);
        }
        return out;
    }
}

function defaultProfile(): EmbeddingProfile {
    const runtime = config.embedding.runtime === 'llama.cpp' ? 'llama.cpp' : 'openai-compatible';
    const modality = config.embedding.modality === 'multimodal' ? 'multimodal' : 'text';
    const baseUrl = runtime === 'llama.cpp'
        ? config.embedding.llama_cpp.base_url
        : config.embedding.base_url;

    return {
        id: config.embedding.profile_id,
        runtime,
        modality,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        baseUrl,
        apiKey: config.embedding.api_key || undefined,
        provider: runtime === 'llama.cpp' ? 'llama.cpp' : config.embedding.provider,
        includeDimensions: config.embedding.include_dimensions,
        batchSize: Math.max(1, config.embedding.batch_size || 10),
        llamaCpp: {
            endpoint: config.embedding.llama_cpp.endpoint,
            mediaMarker: config.embedding.llama_cpp.media_marker,
            embdNormalize: config.embedding.llama_cpp.embd_normalize
        }
    };
}

function normalizeInput(input: string | EmbeddingInput): EmbeddingInput {
    return typeof input === 'string' ? { text: input } : input;
}

function estimateInputUnits(inputs: EmbeddingInput[]): number {
    return inputs.reduce((sum, input) => {
        const textUnits = Math.ceil(input.text.length / 4);
        const mediaUnits = input.mediaBase64?.reduce((n, media) => n + Math.ceil(stripDataUrl(media).length / 1024), 0) ?? 0;
        return sum + textUnits + mediaUnits;
    }, 0);
}

function contentForLlamaCpp(input: EmbeddingInput, profile: EmbeddingProfile): string | { prompt_string: string; multimodal_data: string[] } {
    const media = input.mediaBase64?.filter(Boolean).map(stripDataUrl) ?? [];
    if (media.length === 0) return input.text;
    if (profile.modality !== 'multimodal') {
        throw new Error(`Embedding profile ${profile.id} is not configured for media input.`);
    }
    const marker = profile.llamaCpp?.mediaMarker || '<__media__>';
    const existingMarkerCount = countOccurrences(input.text, marker);
    const prompt_string = existingMarkerCount === media.length
        ? input.text
        : `${Array.from({ length: media.length }, () => marker).join('\n')}\n${input.text}`.trim();
    return { prompt_string, multimodal_data: media };
}

async function fetchJson(url: string, body: unknown, apiKey?: string): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Embedding endpoint returned ${response.status}: ${text.slice(0, 500)}`);
    }
    return response.json();
}

function parseOpenAIEmbeddingsResponse(response: unknown): number[][] {
    const data = (response as { data?: Array<{ embedding?: number[] }> })?.data;
    if (!Array.isArray(data)) throw new Error('Embedding endpoint response did not include data[].');
    return data.map((item) => {
        if (!Array.isArray(item.embedding)) throw new Error('Embedding endpoint response item did not include embedding[].');
        return item.embedding;
    });
}

function parseLlamaCppEmbeddingsResponse(response: unknown): number[][] {
    if (Array.isArray(response)) {
        return response.map((item) => {
            const embedding = (item as { embedding?: number[] | number[][] }).embedding;
            return flattenEmbedding(embedding);
        });
    }
    const data = (response as { data?: Array<{ embedding?: number[] }> })?.data;
    if (Array.isArray(data)) return parseOpenAIEmbeddingsResponse(response);
    const embedding = (response as { embedding?: number[] | number[][] })?.embedding;
    if (embedding) return [flattenEmbedding(embedding)];
    throw new Error('llama.cpp embedding response did not include embedding data.');
}

function flattenEmbedding(embedding: number[] | number[][] | undefined): number[] {
    if (!Array.isArray(embedding)) throw new Error('Embedding response item did not include embedding[].');
    if (embedding.length > 0 && Array.isArray(embedding[0])) {
        return meanPool(embedding as number[][]);
    }
    return embedding as number[];
}

function meanPool(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];
    const dim = vectors[0].length;
    const out = Array.from({ length: dim }, () => 0);
    for (const vector of vectors) {
        for (let i = 0; i < dim; i += 1) out[i] += vector[i] ?? 0;
    }
    return out.map((v) => v / vectors.length);
}

function validateDimensions(vectors: number[][], profile: EmbeddingProfile): void {
    for (const vector of vectors) {
        if (vector.length !== profile.dimensions) {
            throw new Error(`Embedding dimension mismatch for profile ${profile.id}: got ${vector.length}, expected ${profile.dimensions}.`);
        }
    }
}

function stripDataUrl(value: string): string {
    return value.replace(DATA_URL_RE, '');
}

function trimSlash(value: string): string {
    return value.replace(/\/$/, '');
}

function countOccurrences(value: string, needle: string): number {
    if (!needle) return 0;
    return value.split(needle).length - 1;
}
