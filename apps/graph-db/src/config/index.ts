export default {
    port: parseInt(process.env.PORT || '3007', 10),
    node_env: process.env.NODE_ENV || 'development',

    neo4j: {
        uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        username: process.env.NEO4J_USERNAME || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'neo4j',
        database: process.env.NEO4J_DATABASE || 'neo4j'
    },

    cors_origins: (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3003,http://localhost:5173,http://localhost:5174').split(','),

    auth: {
        api_key_header: 'X-Agent-API-Key'
    }
};
