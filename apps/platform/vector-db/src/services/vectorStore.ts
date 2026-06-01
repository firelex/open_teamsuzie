import type { Scope, ScopeRef } from '@teamsuzie/types';
import type {
    DocumentChunkEmbedding,
    DocumentChunkSearchResult,
    DocumentSummaryEmbedding,
    DocumentSummarySearchResult,
    ScopedEmbedding,
    ScopedSearchResult
} from './milvus.js';

export interface VectorStoreStats {
    mainCount: number;
    chunksCount: number;
}

export interface VectorStore {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): Promise<boolean>;
    getStats(): Promise<VectorStoreStats | null>;
    upsertEmbedding(data: ScopedEmbedding): Promise<void>;
    upsertEmbeddings(data: ScopedEmbedding[]): Promise<void>;
    search(embedding: number[], scopes: ScopeRef[], topK?: number, dataType?: string): Promise<ScopedSearchResult[]>;
    deleteById(id: string): Promise<void>;
    deleteByScope(scope: Scope, scopeId: string | null): Promise<void>;
    upsertDocumentChunk(data: DocumentChunkEmbedding): Promise<void>;
    upsertDocumentChunks(data: DocumentChunkEmbedding[]): Promise<void>;
    searchDocumentChunks(embedding: number[], scopes: ScopeRef[], documentId?: string, topK?: number): Promise<DocumentChunkSearchResult[]>;
    deleteDocumentChunks(documentId: string): Promise<void>;
    deleteDocumentChunksByScope(scope: Scope, scopeId: string | null): Promise<void>;
    upsertDocumentSummary(data: DocumentSummaryEmbedding): Promise<void>;
    searchDocumentSummaries(embedding: number[], scopes: ScopeRef[], topK?: number): Promise<DocumentSummarySearchResult[]>;
    deleteDocumentSummary(documentId: string): Promise<void>;
    deleteDocumentSummariesByScope(scope: Scope, scopeId: string | null): Promise<void>;
}
