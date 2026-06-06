export default {
    port: parseInt(process.env.PORT || '3007', 10),
    node_env: process.env.NODE_ENV || 'development',

    // 'neo4j' (default) or 'pg'. Selects which GraphStore implementation the
    // routes hold.
    graph_backend: (process.env.GRAPH_BACKEND || 'neo4j') as 'neo4j' | 'pg',

    neo4j: {
        uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        username: process.env.NEO4J_USERNAME || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'neo4j',
        database: process.env.NEO4J_DATABASE || 'neo4j'
    },

    postgres: {
        url: process.env.POSTGRES_URL || 'postgres://teamsuzie:teamsuzie@localhost:5432/teamsuzie',
        pool_max: parseInt(process.env.POSTGRES_POOL_MAX || '10', 10)
    },

    cors_origins: (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3003,http://localhost:5173,http://localhost:5174').split(','),

    auth: {
        api_key_header: 'X-Agent-API-Key'
    }
};
