export default {
    port: parseInt(process.env.PORT || '3006', 10),
    node_env: process.env.NODE_ENV || 'development',

    milvus: {
        enabled: process.env.MILVUS_ENABLED !== 'false',
        address: process.env.MILVUS_ADDRESS || 'localhost:19530',
        token: process.env.MILVUS_TOKEN || '',
        collection_name: process.env.MILVUS_COLLECTION || collectionNameForProfile(process.env.EMBEDDING_PROFILE_ID || 'default'),
        dimension: parseInt(process.env.EMBEDDING_DIMENSIONS || process.env.MILVUS_DIMENSION || '1024', 10)
    },

    embedding: {
        profile_id: process.env.EMBEDDING_PROFILE_ID || 'default',
        runtime: process.env.EMBEDDING_RUNTIME || 'openai-compatible',
        modality: process.env.EMBEDDING_MODALITY || 'text',
        api_key: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '',
        model: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
        base_url: process.env.EMBEDDING_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        provider: (process.env.EMBEDDING_PROVIDER || 'dashscope') as string,
        dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || process.env.MILVUS_DIMENSION || '1024', 10),
        include_dimensions: process.env.EMBEDDING_INCLUDE_DIMENSIONS !== 'false',
        batch_size: parseInt(process.env.EMBEDDING_BATCH_SIZE || '10', 10),
        llama_cpp: {
            base_url: process.env.LLAMACPP_EMBEDDING_BASE_URL || process.env.EMBEDDING_BASE_URL || 'http://localhost:8080',
            endpoint: process.env.LLAMACPP_EMBEDDING_ENDPOINT || '/embedding',
            media_marker: process.env.LLAMACPP_MEDIA_MARKER || '<__media__>',
            embd_normalize: parseOptionalInt(process.env.LLAMACPP_EMBD_NORMALIZE)
        }
    },

    redis_url: process.env.REDIS_URL || 'redis://localhost:6379/0',
    usage_tracking: process.env.USAGE_TRACKING_ENABLED !== 'false',

    cors_origins: (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3003,http://localhost:5173,http://localhost:5174').split(','),

    auth: {
        api_key_header: 'X-Agent-API-Key'
    }
};

function parseOptionalInt(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isInteger(n) ? n : undefined;
}

function collectionNameForProfile(profileId: string): string {
    if (profileId === 'default') return 'scoped_embeddings';
    const safe = profileId.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return `scoped_embeddings_${safe || 'default'}`;
}
