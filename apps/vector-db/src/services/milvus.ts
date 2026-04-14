import { MilvusClient, DataType, InsertReq, SearchSimpleReq } from '@zilliz/milvus2-sdk-node';
import config from '../config/index.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';

export interface ScopedEmbedding {
    id: string;
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
    data_type?: string;
    scope: Scope;
    scope_id: string | null;
}

export interface ScopedSearchResult {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    data_type?: string;
    score: number;
    scope: Scope;
    scope_id: string | null;
}

export interface DocumentSummaryEmbedding {
    id: string;
    document_id: string;
    content: string;
    topic: string;
    metadata: string;
    embedding: number[];
    scope: Scope;
    scope_id: string | null;
}

export interface DocumentSummarySearchResult {
    id: string;
    document_id: string;
    content: string;
    topic: string;
    metadata: string;
    score: number;
    scope: Scope;
    scope_id: string | null;
}

export interface DocumentChunkEmbedding {
    id: string;
    chunk_id: string;
    document_id: string;
    content: string;
    chunk_index: number;
    metadata: string;
    embedding: number[];
    scope: Scope;
    scope_id: string | null;
}

export interface DocumentChunkSearchResult {
    id: string;
    chunk_id: string;
    document_id: string;
    content: string;
    chunk_index: number;
    metadata: string;
    score: number;
    scope: Scope;
    scope_id: string | null;
}

export default class MilvusService {
    private client: MilvusClient | null = null;
    private mainCollectionName = 'scoped_embeddings';
    private documentChunksCollectionName = 'scoped_document_chunks';
    private documentSummariesCollectionName = 'scoped_document_summaries';
    private dimension: number;
    private mainCollectionInitialized = false;
    private documentChunksInitialized = false;
    private documentSummariesInitialized = false;

    constructor() {
        this.dimension = config.milvus.dimension;
    }

    isEnabled(): boolean {
        return config.milvus.enabled;
    }

    async connect(): Promise<void> {
        if (!this.isEnabled()) {
            console.log('[Milvus] Disabled, skipping connection');
            return;
        }

        if (this.client) return;

        try {
            this.client = new MilvusClient({
                address: config.milvus.address,
                token: config.milvus.token || undefined
            });

            const health = await this.client.checkHealth();
            if (!health.isHealthy) {
                throw new Error('Milvus is not healthy');
            }

            console.log('[Milvus] Connected');
            await this.ensureMainCollection();
        } catch (error) {
            console.error('[Milvus] Failed to connect:', error);
            throw error;
        }
    }

    private async ensureMainCollection(): Promise<void> {
        if (!this.client || this.mainCollectionInitialized) return;

        const hasCollection = await this.client.hasCollection({
            collection_name: this.mainCollectionName
        });

        if (hasCollection.value) {
            await this.client.loadCollection({ collection_name: this.mainCollectionName });
            this.mainCollectionInitialized = true;
            return;
        }

        await this.client.createCollection({
            collection_name: this.mainCollectionName,
            fields: [
                { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
                { name: 'content', data_type: DataType.VarChar, max_length: 8192 },
                { name: 'metadata', data_type: DataType.VarChar, max_length: 4096 },
                { name: 'data_type', data_type: DataType.VarChar, max_length: 32 },
                { name: 'scope', data_type: DataType.VarChar, max_length: 16 },
                { name: 'scope_id', data_type: DataType.VarChar, max_length: 64 },
                { name: 'embedding', data_type: DataType.FloatVector, dim: this.dimension }
            ]
        });

        await this.client.createIndex({
            collection_name: this.mainCollectionName,
            field_name: 'embedding',
            index_type: 'IVF_FLAT',
            metric_type: 'COSINE',
            params: { nlist: 128 }
        });

        await this.client.createIndex({
            collection_name: this.mainCollectionName,
            field_name: 'scope',
            index_type: 'STL_SORT'
        });

        await this.client.createIndex({
            collection_name: this.mainCollectionName,
            field_name: 'scope_id',
            index_type: 'STL_SORT'
        });

        await this.client.createIndex({
            collection_name: this.mainCollectionName,
            field_name: 'data_type',
            index_type: 'STL_SORT'
        });

        await this.client.loadCollection({ collection_name: this.mainCollectionName });
        this.mainCollectionInitialized = true;
        console.log(`[Milvus] Created collection ${this.mainCollectionName}`);
    }

    private async ensureDocumentChunksCollection(): Promise<void> {
        if (!this.client || this.documentChunksInitialized) return;

        const hasCollection = await this.client.hasCollection({
            collection_name: this.documentChunksCollectionName
        });

        if (hasCollection.value) {
            await this.client.loadCollection({ collection_name: this.documentChunksCollectionName });
            this.documentChunksInitialized = true;
            return;
        }

        await this.client.createCollection({
            collection_name: this.documentChunksCollectionName,
            fields: [
                { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
                { name: 'chunk_id', data_type: DataType.VarChar, max_length: 64 },
                { name: 'document_id', data_type: DataType.VarChar, max_length: 64 },
                { name: 'content', data_type: DataType.VarChar, max_length: 8192 },
                { name: 'chunk_index', data_type: DataType.Int64 },
                { name: 'metadata', data_type: DataType.VarChar, max_length: 2048 },
                { name: 'scope', data_type: DataType.VarChar, max_length: 16 },
                { name: 'scope_id', data_type: DataType.VarChar, max_length: 64 },
                { name: 'embedding', data_type: DataType.FloatVector, dim: this.dimension }
            ]
        });

        await this.client.createIndex({
            collection_name: this.documentChunksCollectionName,
            field_name: 'embedding',
            index_type: 'IVF_FLAT',
            metric_type: 'COSINE',
            params: { nlist: 128 }
        });

        for (const field of ['scope', 'scope_id', 'document_id']) {
            await this.client.createIndex({
                collection_name: this.documentChunksCollectionName,
                field_name: field,
                index_type: 'STL_SORT'
            });
        }

        await this.client.loadCollection({ collection_name: this.documentChunksCollectionName });
        this.documentChunksInitialized = true;
        console.log(`[Milvus] Created collection ${this.documentChunksCollectionName}`);
    }

    private buildScopeFilter(scopes: ScopeRef[]): string {
        if (scopes.length === 0) return '';

        const conditions = scopes.map(s => {
            if (s.scope === 'global') {
                return `(scope == "global")`;
            }
            return `(scope == "${s.scope}" && scope_id == "${s.scope_id}")`;
        });

        return conditions.join(' || ');
    }

    async upsertEmbedding(data: ScopedEmbedding): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureMainCollection();

        await this.client.delete({
            collection_name: this.mainCollectionName,
            filter: `id == "${data.id}"`
        });

        const insertReq: InsertReq = {
            collection_name: this.mainCollectionName,
            data: [{
                id: data.id,
                content: data.content.slice(0, 8192),
                metadata: JSON.stringify(data.metadata || {}).slice(0, 4096),
                data_type: data.data_type || '',
                scope: data.scope,
                scope_id: data.scope_id || '',
                embedding: data.embedding
            }]
        };

        await this.client.insert(insertReq);
        await this.client.flush({ collection_names: [this.mainCollectionName] });
    }

    async search(
        embedding: number[],
        scopes: ScopeRef[],
        topK = 10,
        dataType?: string
    ): Promise<ScopedSearchResult[]> {
        if (!this.isEnabled() || !this.client) return [];

        await this.ensureMainCollection();

        let filter = this.buildScopeFilter(scopes);
        if (dataType) {
            const dtFilter = `data_type == "${dataType}"`;
            filter = filter ? `(${filter}) && ${dtFilter}` : dtFilter;
        }

        const searchReq: SearchSimpleReq = {
            collection_name: this.mainCollectionName,
            data: [embedding],
            filter: filter || undefined,
            limit: topK,
            output_fields: ['id', 'content', 'metadata', 'data_type', 'scope', 'scope_id']
        };

        const result = await this.client.search(searchReq);

        if (!result.results || result.results.length === 0) return [];

        return result.results.map(r => ({
            id: r.id as string,
            content: r.content as string,
            metadata: JSON.parse((r.metadata as string) || '{}'),
            data_type: (r.data_type as string) || undefined,
            score: r.score as number,
            scope: r.scope as Scope,
            scope_id: (r.scope_id as string) || null
        }));
    }

    async deleteById(id: string): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.client.delete({
            collection_name: this.mainCollectionName,
            filter: `id == "${id}"`
        });
    }

    async deleteByScope(scope: Scope, scopeId: string | null): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        let filter = `scope == "${scope}"`;
        if (scopeId) {
            filter += ` && scope_id == "${scopeId}"`;
        }

        await this.client.delete({
            collection_name: this.mainCollectionName,
            filter
        });
    }

    // Document chunks methods

    async upsertDocumentChunk(data: DocumentChunkEmbedding): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureDocumentChunksCollection();

        await this.client.delete({
            collection_name: this.documentChunksCollectionName,
            filter: `id == "${data.id}"`
        });

        const insertReq: InsertReq = {
            collection_name: this.documentChunksCollectionName,
            data: [{
                id: data.id,
                chunk_id: data.chunk_id,
                document_id: data.document_id,
                content: data.content.slice(0, 8192),
                chunk_index: data.chunk_index,
                metadata: data.metadata.slice(0, 2048),
                scope: data.scope,
                scope_id: data.scope_id || '',
                embedding: data.embedding
            }]
        };

        await this.client.insert(insertReq);
        await this.client.flush({ collection_names: [this.documentChunksCollectionName] });
    }

    async upsertDocumentChunks(data: DocumentChunkEmbedding[]): Promise<void> {
        if (!this.isEnabled() || !this.client || data.length === 0) return;

        await this.ensureDocumentChunksCollection();

        const ids = data.map(d => `"${d.id}"`).join(', ');
        await this.client.delete({
            collection_name: this.documentChunksCollectionName,
            filter: `id in [${ids}]`
        });

        const insertReq: InsertReq = {
            collection_name: this.documentChunksCollectionName,
            data: data.map(d => ({
                id: d.id,
                chunk_id: d.chunk_id,
                document_id: d.document_id,
                content: d.content.slice(0, 8192),
                chunk_index: d.chunk_index,
                metadata: d.metadata.slice(0, 2048),
                scope: d.scope,
                scope_id: d.scope_id || '',
                embedding: d.embedding
            }))
        };

        await this.client.insert(insertReq);
        await this.client.flush({ collection_names: [this.documentChunksCollectionName] });
    }

    async searchDocumentChunks(
        embedding: number[],
        scopes: ScopeRef[],
        documentId?: string,
        topK = 10
    ): Promise<DocumentChunkSearchResult[]> {
        if (!this.isEnabled() || !this.client) return [];

        await this.ensureDocumentChunksCollection();

        let filter = this.buildScopeFilter(scopes);
        if (documentId) {
            filter = filter
                ? `(${filter}) && document_id == "${documentId}"`
                : `document_id == "${documentId}"`;
        }

        const searchReq: SearchSimpleReq = {
            collection_name: this.documentChunksCollectionName,
            data: [embedding],
            filter: filter || undefined,
            limit: topK,
            output_fields: ['id', 'chunk_id', 'document_id', 'content', 'chunk_index', 'metadata', 'scope', 'scope_id']
        };

        const result = await this.client.search(searchReq);

        if (!result.results || result.results.length === 0) return [];

        return result.results.map(r => ({
            id: r.id as string,
            chunk_id: r.chunk_id as string,
            document_id: r.document_id as string,
            content: r.content as string,
            chunk_index: r.chunk_index as number,
            metadata: r.metadata as string,
            score: r.score as number,
            scope: r.scope as Scope,
            scope_id: (r.scope_id as string) || null
        }));
    }

    async deleteDocumentChunks(documentId: string): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureDocumentChunksCollection();

        await this.client.delete({
            collection_name: this.documentChunksCollectionName,
            filter: `document_id == "${documentId}"`
        });
    }

    async isConnected(): Promise<boolean> {
        if (!this.isEnabled() || !this.client) return false;

        try {
            const health = await this.client.checkHealth();
            return health.isHealthy;
        } catch {
            return false;
        }
    }

    async getStats(): Promise<{ mainCount: number; chunksCount: number } | null> {
        if (!this.isEnabled() || !this.client) return null;

        try {
            const mainStats = await this.client.getCollectionStatistics({
                collection_name: this.mainCollectionName
            });

            let chunksCount = 0;
            try {
                await this.ensureDocumentChunksCollection();
                const chunksStats = await this.client.getCollectionStatistics({
                    collection_name: this.documentChunksCollectionName
                });
                chunksCount = Number(chunksStats.data.row_count) || 0;
            } catch {
                // Collection might not exist yet
            }

            return {
                mainCount: Number(mainStats.data.row_count) || 0,
                chunksCount
            };
        } catch {
            return null;
        }
    }

    // Batch upsert embeddings

    async upsertEmbeddings(data: ScopedEmbedding[]): Promise<void> {
        if (!this.isEnabled() || !this.client || data.length === 0) return;

        await this.ensureMainCollection();

        const ids = data.map(d => `"${d.id}"`).join(', ');
        await this.client.delete({
            collection_name: this.mainCollectionName,
            filter: `id in [${ids}]`
        });

        const insertReq: InsertReq = {
            collection_name: this.mainCollectionName,
            data: data.map(d => ({
                id: d.id,
                content: d.content.slice(0, 8192),
                metadata: JSON.stringify(d.metadata || {}).slice(0, 4096),
                data_type: d.data_type || '',
                scope: d.scope,
                scope_id: d.scope_id || '',
                embedding: d.embedding
            }))
        };

        await this.client.insert(insertReq);
        await this.client.flush({ collection_names: [this.mainCollectionName] });
    }

    // Delete document chunks by scope

    async deleteDocumentChunksByScope(scope: Scope, scopeId: string | null): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureDocumentChunksCollection();

        let filter = `scope == "${scope}"`;
        if (scopeId) {
            filter += ` && scope_id == "${scopeId}"`;
        }

        await this.client.delete({
            collection_name: this.documentChunksCollectionName,
            filter
        });
    }

    // Document summaries collection

    private async ensureDocumentSummariesCollection(): Promise<void> {
        if (!this.client || this.documentSummariesInitialized) return;

        const hasCollection = await this.client.hasCollection({
            collection_name: this.documentSummariesCollectionName
        });

        if (hasCollection.value) {
            await this.client.loadCollection({ collection_name: this.documentSummariesCollectionName });
            this.documentSummariesInitialized = true;
            return;
        }

        await this.client.createCollection({
            collection_name: this.documentSummariesCollectionName,
            fields: [
                { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
                { name: 'document_id', data_type: DataType.VarChar, max_length: 64 },
                { name: 'content', data_type: DataType.VarChar, max_length: 4096 },
                { name: 'topic', data_type: DataType.VarChar, max_length: 256 },
                { name: 'metadata', data_type: DataType.VarChar, max_length: 2048 },
                { name: 'scope', data_type: DataType.VarChar, max_length: 16 },
                { name: 'scope_id', data_type: DataType.VarChar, max_length: 64 },
                { name: 'embedding', data_type: DataType.FloatVector, dim: this.dimension }
            ]
        });

        await this.client.createIndex({
            collection_name: this.documentSummariesCollectionName,
            field_name: 'embedding',
            index_type: 'IVF_FLAT',
            metric_type: 'COSINE',
            params: { nlist: 128 }
        });

        for (const field of ['scope', 'scope_id', 'document_id']) {
            await this.client.createIndex({
                collection_name: this.documentSummariesCollectionName,
                field_name: field,
                index_type: 'STL_SORT'
            });
        }

        await this.client.loadCollection({ collection_name: this.documentSummariesCollectionName });
        this.documentSummariesInitialized = true;
        console.log(`[Milvus] Created collection ${this.documentSummariesCollectionName}`);
    }

    async upsertDocumentSummary(data: DocumentSummaryEmbedding): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureDocumentSummariesCollection();

        await this.client.delete({
            collection_name: this.documentSummariesCollectionName,
            filter: `id == "${data.id}"`
        });

        const insertReq: InsertReq = {
            collection_name: this.documentSummariesCollectionName,
            data: [{
                id: data.id,
                document_id: data.document_id,
                content: data.content.slice(0, 4096),
                topic: data.topic.slice(0, 256),
                metadata: data.metadata.slice(0, 2048),
                scope: data.scope,
                scope_id: data.scope_id || '',
                embedding: data.embedding
            }]
        };

        await this.client.insert(insertReq);
        await this.client.flush({ collection_names: [this.documentSummariesCollectionName] });
    }

    async searchDocumentSummaries(
        embedding: number[],
        scopes: ScopeRef[],
        topK = 10
    ): Promise<DocumentSummarySearchResult[]> {
        if (!this.isEnabled() || !this.client) return [];

        await this.ensureDocumentSummariesCollection();

        const filter = this.buildScopeFilter(scopes);

        const searchReq: SearchSimpleReq = {
            collection_name: this.documentSummariesCollectionName,
            data: [embedding],
            filter: filter || undefined,
            limit: topK,
            output_fields: ['id', 'document_id', 'content', 'topic', 'metadata', 'scope', 'scope_id']
        };

        const result = await this.client.search(searchReq);

        if (!result.results || result.results.length === 0) return [];

        return result.results.map(r => ({
            id: r.id as string,
            document_id: r.document_id as string,
            content: r.content as string,
            topic: r.topic as string,
            metadata: r.metadata as string,
            score: r.score as number,
            scope: r.scope as Scope,
            scope_id: (r.scope_id as string) || null
        }));
    }

    async deleteDocumentSummary(documentId: string): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureDocumentSummariesCollection();

        await this.client.delete({
            collection_name: this.documentSummariesCollectionName,
            filter: `document_id == "${documentId}"`
        });
    }

    async deleteDocumentSummariesByScope(scope: Scope, scopeId: string | null): Promise<void> {
        if (!this.isEnabled() || !this.client) return;

        await this.ensureDocumentSummariesCollection();

        let filter = `scope == "${scope}"`;
        if (scopeId) {
            filter += ` && scope_id == "${scopeId}"`;
        }

        await this.client.delete({
            collection_name: this.documentSummariesCollectionName,
            filter
        });
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.closeConnection();
            this.client = null;
            this.mainCollectionInitialized = false;
            this.documentChunksInitialized = false;
            this.documentSummariesInitialized = false;
            console.log('[Milvus] Disconnected');
        }
    }
}
