export default {
    port: parseInt(process.env.PORT || '3006', 10),
    node_env: process.env.NODE_ENV || 'development',

    milvus: {
        enabled: process.env.MILVUS_ENABLED !== 'false',
        address: process.env.MILVUS_ADDRESS || 'localhost:19530',
        token: process.env.MILVUS_TOKEN || '',
        collection_name: process.env.MILVUS_COLLECTION || 'entity_embeddings',
        dimension: parseInt(process.env.MILVUS_DIMENSION || '1024', 10)
    },

    embedding: {
        api_key: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '',
        model: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
        base_url: process.env.EMBEDDING_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        provider: (process.env.EMBEDDING_PROVIDER || 'dashscope') as string,
        dimensions: parseInt(process.env.MILVUS_DIMENSION || '1024', 10)
    },

    redis_url: process.env.REDIS_URL || 'redis://localhost:6379/0',
    usage_tracking: process.env.USAGE_TRACKING_ENABLED !== 'false',

    cors_origins: (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3003,http://localhost:5173,http://localhost:5174').split(','),

    auth: {
        api_key_header: 'X-Agent-API-Key'
    }
};
