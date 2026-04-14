import type {
    Scope,
    ScopeRef,
    VectorSearchResult,
    GraphSearchResult,
    ApiResponse
} from '@teamsuzie/types';

export interface DbClientConfig {
    baseUrl: string;
    apiKey?: string;
    timeout?: number;
}

export interface VectorSearchOptions {
    query: string;
    scopes: ScopeRef[];
    embedding?: number[];
    limit?: number;
    documentId?: string;
    data_type?: string;
}

export interface VectorUpsertOptions {
    id?: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    data_type?: string;
    scope: Scope;
    scope_id: string | null;
}

export interface DocumentSummaryUpsertOptions {
    id?: string;
    document_id: string;
    content: string;
    topic?: string;
    metadata?: Record<string, unknown>;
    embedding?: number[];
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

export interface DocumentChunk {
    id: string;
    chunk_id: string;
    content: string;
    chunk_index: number;
    metadata?: Record<string, unknown>;
    embedding?: number[];
    scope: Scope;
    scope_id: string | null;
}

export interface IngestOptions {
    content: string;
    source_type: 'file' | 'url' | 'text';
    source_name: string;
    scope: Scope;
    scope_id: string | null;
    metadata?: Record<string, unknown>;
}

export class VectorDbClient {
    private config: Required<DbClientConfig>;

    constructor(config: DbClientConfig) {
        this.config = {
            baseUrl: config.baseUrl.replace(/\/$/, ''),
            apiKey: config.apiKey || '',
            timeout: config.timeout || 30000
        };
    }

    private async request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<ApiResponse<T>> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.config.apiKey) {
            headers['X-Agent-API-Key'] = this.config.apiKey;
        }

        const response = await fetch(`${this.config.baseUrl}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(this.config.timeout)
        });

        const data = await response.json();
        return data as ApiResponse<T>;
    }

    async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
        const response = await this.request<VectorSearchResult[]>('POST', '/api/v1/search', {
            query: options.query,
            scopes: options.scopes,
            embedding: options.embedding,
            limit: options.limit,
            data_type: options.data_type
        });

        if (!response.success) {
            throw new Error(response.error || 'Search failed');
        }

        return response.data || [];
    }

    async searchDocuments(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
        const response = await this.request<VectorSearchResult[]>('POST', '/api/v1/documents/search', {
            query: options.query,
            scopes: options.scopes,
            embedding: options.embedding,
            document_id: options.documentId,
            limit: options.limit
        });

        if (!response.success) {
            throw new Error(response.error || 'Document search failed');
        }

        return response.data || [];
    }

    async upsert(options: VectorUpsertOptions): Promise<{ id: string }> {
        const response = await this.request<{ id: string }>('POST', '/api/v1/embeddings', options);

        if (!response.success) {
            throw new Error(response.error || 'Upsert failed');
        }

        return response.data!;
    }

    async delete(id: string): Promise<void> {
        const response = await this.request<void>('DELETE', `/api/v1/embeddings/${id}`);

        if (!response.success) {
            throw new Error(response.error || 'Delete failed');
        }
    }

    async upsertDocumentChunks(documentId: string, chunks: DocumentChunk[]): Promise<{ document_id: string; chunk_count: number }> {
        const response = await this.request<{ document_id: string; chunk_count: number }>(
            'POST',
            `/api/v1/documents/${documentId}/chunks`,
            { chunks }
        );

        if (!response.success) {
            throw new Error(response.error || 'Chunk upsert failed');
        }

        return response.data!;
    }

    async deleteDocumentChunks(documentId: string): Promise<void> {
        const response = await this.request<void>('DELETE', `/api/v1/documents/${documentId}/chunks`);

        if (!response.success) {
            throw new Error(response.error || 'Delete chunks failed');
        }
    }

    async ingest(options: IngestOptions): Promise<{ document_id: string; chunk_count: number }> {
        const response = await this.request<{ document_id: string; chunk_count: number }>(
            'POST',
            '/api/v1/knowledge-base/ingest',
            options
        );

        if (!response.success) {
            throw new Error(response.error || 'Ingest failed');
        }

        return response.data!;
    }

    async upsertBatch(items: VectorUpsertOptions[]): Promise<{ count: number }> {
        const response = await this.request<{ count: number }>('POST', '/api/v1/embeddings/batch', { items });

        if (!response.success) {
            throw new Error(response.error || 'Batch upsert failed');
        }

        return response.data!;
    }

    async deleteByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const response = await this.request<void>('DELETE', '/api/v1/embeddings/by-scope', {
            scope,
            scope_id: scopeId
        });

        if (!response.success) {
            throw new Error(response.error || 'Delete by scope failed');
        }
    }

    async upsertDocumentSummary(options: DocumentSummaryUpsertOptions): Promise<{ id: string; document_id: string }> {
        const response = await this.request<{ id: string; document_id: string }>(
            'POST',
            '/api/v1/documents/summaries',
            options
        );

        if (!response.success) {
            throw new Error(response.error || 'Document summary upsert failed');
        }

        return response.data!;
    }

    async searchDocumentSummaries(options: VectorSearchOptions): Promise<DocumentSummarySearchResult[]> {
        const response = await this.request<DocumentSummarySearchResult[]>(
            'POST',
            '/api/v1/documents/summaries/search',
            {
                query: options.query,
                scopes: options.scopes,
                embedding: options.embedding,
                limit: options.limit
            }
        );

        if (!response.success) {
            throw new Error(response.error || 'Document summary search failed');
        }

        return response.data || [];
    }

    async deleteDocumentSummary(documentId: string): Promise<void> {
        const response = await this.request<void>('DELETE', `/api/v1/documents/${documentId}/summary`);

        if (!response.success) {
            throw new Error(response.error || 'Delete document summary failed');
        }
    }

    async deleteDocumentSummariesByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const response = await this.request<void>('DELETE', '/api/v1/documents/summaries/by-scope', {
            scope,
            scope_id: scopeId
        });

        if (!response.success) {
            throw new Error(response.error || 'Delete summaries by scope failed');
        }
    }

    async deleteDocumentChunksByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const response = await this.request<void>('DELETE', '/api/v1/documents/chunks/by-scope', {
            scope,
            scope_id: scopeId
        });

        if (!response.success) {
            throw new Error(response.error || 'Delete chunks by scope failed');
        }
    }

    async stats(): Promise<{ mainCount: number; chunksCount: number } | null> {
        const response = await this.request<{ mainCount: number; chunksCount: number }>('GET', '/api/v1/stats');

        if (!response.success) {
            throw new Error(response.error || 'Stats failed');
        }

        return response.data || null;
    }

    async health(): Promise<{ status: string; milvus_enabled: boolean }> {
        const response = await this.request<{ status: string; milvus_enabled: boolean }>('GET', '/api/health');
        return response.data || { status: 'unknown', milvus_enabled: false };
    }
}

export type EntityType = 'person' | 'org' | 'project' | 'task' | 'doc' | 'role' | 'trait' | 'topic' | 'location' | 'product';

export interface EntityCreateOptions {
    id?: string;
    name: string;
    type: EntityType;
    properties?: Record<string, unknown>;
    scope: Scope;
    scope_id: string | null;
}

export interface RelationshipCreateOptions {
    from_id: string;
    to_id: string;
    type: string;
    properties?: Record<string, unknown>;
}

export interface EntitySearchOptions {
    q: string;
    scopes: ScopeRef[];
    type?: EntityType;
    limit?: number;
}

export interface CypherQueryOptions {
    query: string;
    params?: Record<string, unknown>;
}

export class GraphDbClient {
    private config: Required<DbClientConfig>;

    constructor(config: DbClientConfig) {
        this.config = {
            baseUrl: config.baseUrl.replace(/\/$/, ''),
            apiKey: config.apiKey || '',
            timeout: config.timeout || 30000
        };
    }

    private async request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<ApiResponse<T>> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.config.apiKey) {
            headers['X-Agent-API-Key'] = this.config.apiKey;
        }

        const response = await fetch(`${this.config.baseUrl}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(this.config.timeout)
        });

        const data = await response.json();
        return data as ApiResponse<T>;
    }

    async createEntity(options: EntityCreateOptions): Promise<{ id: string; name: string; type: string }> {
        const response = await this.request<{ id: string; name: string; type: string }>(
            'POST',
            '/api/v1/entities',
            options
        );

        if (!response.success) {
            throw new Error(response.error || 'Entity creation failed');
        }

        return response.data!;
    }

    async getEntity(id: string, scopes?: ScopeRef[]): Promise<GraphSearchResult | null> {
        const params = scopes ? `?scopes=${encodeURIComponent(JSON.stringify(scopes))}` : '';
        const response = await this.request<GraphSearchResult>('GET', `/api/v1/entities/${id}${params}`);

        if (!response.success) {
            if (response.error === 'Entity not found') {
                return null;
            }
            throw new Error(response.error || 'Get entity failed');
        }

        return response.data!;
    }

    async deleteEntity(id: string): Promise<void> {
        const response = await this.request<void>('DELETE', `/api/v1/entities/${id}`);

        if (!response.success) {
            throw new Error(response.error || 'Delete failed');
        }
    }

    async search(options: EntitySearchOptions): Promise<GraphSearchResult[]> {
        const response = await this.request<GraphSearchResult[]>('POST', '/api/v1/entities/search', options);

        if (!response.success) {
            throw new Error(response.error || 'Search failed');
        }

        return response.data || [];
    }

    async createRelationship(options: RelationshipCreateOptions): Promise<{ from_id: string; to_id: string; type: string }> {
        const response = await this.request<{ from_id: string; to_id: string; type: string }>(
            'POST',
            '/api/v1/relationships',
            options
        );

        if (!response.success) {
            throw new Error(response.error || 'Relationship creation failed');
        }

        return response.data!;
    }

    async createEntities(entities: EntityCreateOptions[]): Promise<{ ids: string[]; count: number }> {
        const response = await this.request<{ ids: string[]; count: number }>(
            'POST',
            '/api/v1/entities/batch',
            { entities }
        );

        if (!response.success) {
            throw new Error(response.error || 'Batch entity creation failed');
        }

        return response.data!;
    }

    async createRelationships(relationships: RelationshipCreateOptions[]): Promise<{ count: number }> {
        const response = await this.request<{ count: number }>(
            'POST',
            '/api/v1/relationships/batch',
            { relationships }
        );

        if (!response.success) {
            throw new Error(response.error || 'Batch relationship creation failed');
        }

        return response.data!;
    }

    async getRelationships(scopes: ScopeRef[], limit?: number): Promise<Array<{
        from_id: string;
        from_name: string;
        from_type: string;
        to_id: string;
        to_name: string;
        to_type: string;
        relationship: string;
        properties: Record<string, unknown>;
    }>> {
        const params = new URLSearchParams({
            scopes: JSON.stringify(scopes)
        });
        if (limit) params.set('limit', String(limit));

        const response = await this.request<Array<{
            from_id: string;
            from_name: string;
            from_type: string;
            to_id: string;
            to_name: string;
            to_type: string;
            relationship: string;
            properties: Record<string, unknown>;
        }>>('GET', `/api/v1/relationships?${params.toString()}`);

        if (!response.success) {
            throw new Error(response.error || 'Get relationships failed');
        }

        return response.data || [];
    }

    async deleteByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const response = await this.request<void>('DELETE', '/api/v1/entities/by-scope', {
            scope,
            scope_id: scopeId
        });

        if (!response.success) {
            throw new Error(response.error || 'Delete by scope failed');
        }
    }

    async stats(): Promise<{ nodeCount: number; relationshipCount: number } | null> {
        const response = await this.request<{ nodeCount: number; relationshipCount: number }>('GET', '/api/v1/stats');

        if (!response.success) {
            throw new Error(response.error || 'Stats failed');
        }

        return response.data || null;
    }

    async query(options: CypherQueryOptions): Promise<unknown[]> {
        const response = await this.request<unknown[]>('POST', '/api/v1/query/cypher', options);

        if (!response.success) {
            throw new Error(response.error || 'Query failed');
        }

        return response.data || [];
    }

    async health(): Promise<{ status: string }> {
        const response = await this.request<{ status: string }>('GET', '/api/health');
        return response.data || { status: 'unknown' };
    }
}

// Re-export types
export type { Scope, ScopeRef, VectorSearchResult, GraphSearchResult, ApiResponse };
