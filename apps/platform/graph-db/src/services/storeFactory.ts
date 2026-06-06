import config from '../config/index.js';
import Neo4jService from './neo4j.js';
import PgGraphService from './pgGraph.js';
import type { GraphStore } from './graphStore.js';

let instance: GraphStore | null = null;

export function createGraphStore(): GraphStore {
    if (instance) return instance;
    if (config.graph_backend === 'pg') {
        console.log('[graph-db] backend = pg');
        instance = new PgGraphService();
    } else {
        console.log('[graph-db] backend = neo4j');
        instance = new Neo4jService();
    }
    return instance;
}

export function backendName(): 'neo4j' | 'pg' {
    return config.graph_backend;
}
