import type { Scope, ScopeRef } from '@teamsuzie/types';

export type EntityType =
    | 'person'
    | 'org'
    | 'project'
    | 'task'
    | 'doc'
    | 'role'
    | 'trait'
    | 'topic'
    | 'location'
    | 'product';

export interface ScopedEntity {
    id?: string;
    name: string;
    type: EntityType;
    properties?: Record<string, unknown>;
    scope: Scope;
    scope_id: string | null;
}

export interface RelationshipData {
    from_id: string;
    to_id: string;
    type: string;
    properties?: Record<string, unknown>;
}

export interface SearchResult {
    id: string;
    name: string;
    type: string;
    properties: Record<string, unknown>;
    score?: number;
    scope: Scope;
    scope_id: string | null;
}

export interface RelationshipRow {
    from_id: string;
    from_name: string;
    from_type: string;
    to_id: string;
    to_name: string;
    to_type: string;
    relationship: string;
    properties: Record<string, unknown>;
}

export interface GraphStoreStats {
    nodeCount: number;
    relationshipCount: number;
}

export interface GraphStore {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): Promise<boolean>;
    getStats(): Promise<GraphStoreStats | null>;
    createOrUpdateEntity(entity: ScopedEntity): Promise<string>;
    createEntitiesBatch(entities: ScopedEntity[]): Promise<string[]>;
    getEntity(entityId: string, scopes?: ScopeRef[]): Promise<SearchResult | null>;
    searchEntities(query: string, scopes: ScopeRef[], entityType?: EntityType, limit?: number): Promise<SearchResult[]>;
    deleteEntity(entityId: string): Promise<void>;
    deleteByScope(scope: Scope, scopeId: string | null): Promise<void>;
    createRelationship(rel: RelationshipData): Promise<void>;
    createRelationshipsBatch(rels: RelationshipData[]): Promise<void>;
    getRelationships(scopes: ScopeRef[], limit?: number): Promise<RelationshipRow[]>;
    runQuery(query: string, params?: Record<string, unknown>): Promise<unknown[]>;
}
