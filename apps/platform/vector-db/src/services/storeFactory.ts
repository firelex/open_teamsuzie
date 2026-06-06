import config from '../config/index.js';
import MilvusService from './milvus.js';
import PgVectorService from './pgvector.js';
import type { VectorStore } from './vectorStore.js';

let instance: VectorStore | null = null;

export function createVectorStore(): VectorStore {
    if (instance) return instance;
    if (config.vector_backend === 'pgvector') {
        console.log('[vector-db] backend = pgvector');
        instance = new PgVectorService();
    } else {
        console.log('[vector-db] backend = milvus');
        instance = new MilvusService();
    }
    return instance;
}
