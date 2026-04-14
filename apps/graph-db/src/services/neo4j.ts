import neo4j, { Driver, Session, ManagedTransaction } from 'neo4j-driver';
import config from '../config/index.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';

export type EntityType = 'person' | 'org' | 'project' | 'task' | 'doc' | 'role' | 'trait' | 'topic' | 'location' | 'product';

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

export default class Neo4jService {
    private driver: Driver | null = null;

    async connect(): Promise<void> {
        if (this.driver) return;

        try {
            this.driver = neo4j.driver(
                config.neo4j.uri,
                neo4j.auth.basic(config.neo4j.username, config.neo4j.password)
            );

            await this.driver.verifyConnectivity();
            console.log('[Neo4j] Connected');

            await this.createIndexes();
        } catch (error) {
            console.error('[Neo4j] Failed to connect:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (this.driver) {
            await this.driver.close();
            this.driver = null;
            console.log('[Neo4j] Disconnected');
        }
    }

    private getSession(): Session {
        if (!this.driver) {
            throw new Error('Neo4j driver not initialized. Call connect() first.');
        }
        return this.driver.session({ database: config.neo4j.database });
    }

    private getLabel(type: EntityType): string {
        const labels: Record<EntityType, string> = {
            person: 'Person',
            org: 'Organization',
            project: 'Project',
            task: 'Task',
            doc: 'Document',
            role: 'Role',
            trait: 'Trait',
            topic: 'Topic',
            location: 'Location',
            product: 'Product'
        };
        return labels[type] || 'Entity';
    }

    private buildScopeCondition(alias: string, scopes: ScopeRef[], paramPrefix = 'sc'): { condition: string; params: Record<string, string> } {
        if (scopes.length === 0) return { condition: '', params: {} };

        const params: Record<string, string> = {};
        const conditions = scopes.map((s, i) => {
            if (s.scope === 'global') {
                return `${alias}.scope = 'global'`;
            }
            const scopeKey = `${paramPrefix}_scope_${i}`;
            const idKey = `${paramPrefix}_sid_${i}`;
            params[scopeKey] = s.scope;
            params[idKey] = s.scope_id || '';
            return `(${alias}.scope = $${scopeKey} AND ${alias}.scope_id = $${idKey})`;
        });

        return { condition: conditions.join(' OR '), params };
    }

    async createIndexes(): Promise<void> {
        const session = this.getSession();
        try {
            const labels = ['Person', 'Organization', 'Project', 'Task', 'Document', 'Role', 'Trait', 'Topic', 'Location', 'Product'];

            for (const label of labels) {
                await session.executeWrite(async (tx: ManagedTransaction) => {
                    await tx.run(`CREATE INDEX ${label.toLowerCase()}_scope IF NOT EXISTS FOR (n:${label}) ON (n.scope, n.scope_id)`);
                });
                await session.executeWrite(async (tx: ManagedTransaction) => {
                    await tx.run(`CREATE INDEX ${label.toLowerCase()}_entity_id IF NOT EXISTS FOR (n:${label}) ON (n.entity_id)`);
                });
            }

            // Create full-text indexes
            await session.executeWrite(async (tx: ManagedTransaction) => {
                await tx.run(`
                    CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
                    FOR (n:Person|Organization|Project|Task|Document|Role|Topic|Location|Product)
                    ON EACH [n.name, n.name_normalized]
                `);
            });

            console.log('[Neo4j] Created indexes');
        } catch (error) {
            console.error('[Neo4j] Failed to create indexes:', error);
        } finally {
            await session.close();
        }
    }

    async createOrUpdateEntity(entity: ScopedEntity): Promise<string> {
        const session = this.getSession();
        try {
            const label = this.getLabel(entity.type);
            const entityId = entity.id || crypto.randomUUID();
            const nameNormalized = entity.name.toLowerCase().trim();

            const result = await session.executeWrite(async (tx: ManagedTransaction) => {
                const res = await tx.run(
                    `MERGE (n:${label} {entity_id: $entityId})
                     ON CREATE SET
                        n.name = $name,
                        n.name_normalized = $nameNormalized,
                        n.scope = $scope,
                        n.scope_id = $scopeId,
                        n.properties = $properties,
                        n.createdAt = datetime()
                     ON MATCH SET
                        n.name = COALESCE($name, n.name),
                        n.name_normalized = COALESCE($nameNormalized, n.name_normalized),
                        n.properties = COALESCE($properties, n.properties),
                        n.updatedAt = datetime()
                     RETURN n.entity_id as id`,
                    {
                        entityId,
                        name: entity.name,
                        nameNormalized,
                        scope: entity.scope,
                        scopeId: entity.scope_id || '',
                        properties: JSON.stringify(entity.properties || {})
                    }
                );
                return res.records[0]?.get('id') as string;
            });

            return result;
        } finally {
            await session.close();
        }
    }

    async getEntity(entityId: string, scopes?: ScopeRef[]): Promise<SearchResult | null> {
        const session = this.getSession();
        try {
            const result = await session.executeRead(async (tx: ManagedTransaction) => {
                let query = `
                    MATCH (n {entity_id: $entityId})
                `;

                let scopeParams: Record<string, string> = {};
                if (scopes && scopes.length > 0) {
                    const { condition, params } = this.buildScopeCondition('n', scopes);
                    query += ` WHERE ${condition}`;
                    scopeParams = params;
                }

                query += `
                    RETURN
                        n.entity_id as id,
                        n.name as name,
                        labels(n)[0] as type,
                        n.properties as properties,
                        n.scope as scope,
                        n.scope_id as scope_id
                    LIMIT 1
                `;

                const res = await tx.run(query, { entityId, ...scopeParams });

                if (res.records.length === 0) return null;

                const record = res.records[0];
                return {
                    id: record.get('id') as string,
                    name: record.get('name') as string,
                    type: (record.get('type') as string).toLowerCase(),
                    properties: JSON.parse((record.get('properties') as string) || '{}'),
                    scope: record.get('scope') as Scope,
                    scope_id: record.get('scope_id') as string || null
                };
            });

            return result;
        } finally {
            await session.close();
        }
    }

    async searchEntities(
        query: string,
        scopes: ScopeRef[],
        entityType?: EntityType,
        limit = 10
    ): Promise<SearchResult[]> {
        const session = this.getSession();
        try {
            const result = await session.executeRead(async (tx: ManagedTransaction) => {
                const escapedQuery = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
                const fuzzyQuery = `${escapedQuery}~`;

                let cypher = `
                    CALL db.index.fulltext.queryNodes('entity_search', $query)
                    YIELD node, score
                `;

                const conditions: string[] = [];
                let scopeParams: Record<string, string> = {};

                if (scopes.length > 0) {
                    const { condition, params } = this.buildScopeCondition('node', scopes);
                    conditions.push(`(${condition})`);
                    scopeParams = params;
                }

                if (entityType) {
                    const label = this.getLabel(entityType);
                    // label is safe - sourced from whitelist in getLabel()
                    conditions.push(`'${label}' IN labels(node)`);
                }

                if (conditions.length > 0) {
                    cypher += ` WHERE ${conditions.join(' AND ')}`;
                }

                cypher += `
                    RETURN
                        node.entity_id as id,
                        node.name as name,
                        labels(node)[0] as type,
                        node.properties as properties,
                        score,
                        node.scope as scope,
                        node.scope_id as scope_id
                    ORDER BY score DESC
                    LIMIT $limit
                `;

                const res = await tx.run(cypher, {
                    query: fuzzyQuery,
                    limit: neo4j.int(limit),
                    ...scopeParams
                });

                return res.records.map(record => ({
                    id: record.get('id') as string,
                    name: record.get('name') as string,
                    type: (record.get('type') as string).toLowerCase(),
                    properties: JSON.parse((record.get('properties') as string) || '{}'),
                    score: record.get('score') as number,
                    scope: record.get('scope') as Scope,
                    scope_id: record.get('scope_id') as string || null
                }));
            });

            return result;
        } catch (error) {
            // If fulltext index doesn't exist, fall back to CONTAINS
            console.warn('[Neo4j] Fulltext search failed, falling back to CONTAINS:', error);
            return this.searchEntitiesFallback(query, scopes, entityType, limit);
        } finally {
            await session.close();
        }
    }

    private async searchEntitiesFallback(
        query: string,
        scopes: ScopeRef[],
        entityType?: EntityType,
        limit = 10
    ): Promise<SearchResult[]> {
        const session = this.getSession();
        try {
            const result = await session.executeRead(async (tx: ManagedTransaction) => {
                let cypher = `
                    MATCH (n)
                    WHERE n.name_normalized CONTAINS $query
                `;

                let scopeParams: Record<string, string> = {};

                if (scopes.length > 0) {
                    const { condition, params } = this.buildScopeCondition('n', scopes, 'fb');
                    cypher += ` AND (${condition})`;
                    scopeParams = params;
                }

                if (entityType) {
                    const label = this.getLabel(entityType);
                    // label is safe - sourced from whitelist in getLabel()
                    cypher += ` AND '${label}' IN labels(n)`;
                }

                cypher += `
                    RETURN
                        n.entity_id as id,
                        n.name as name,
                        labels(n)[0] as type,
                        n.properties as properties,
                        n.scope as scope,
                        n.scope_id as scope_id
                    LIMIT $limit
                `;

                const res = await tx.run(cypher, {
                    query: query.toLowerCase(),
                    limit: neo4j.int(limit),
                    ...scopeParams
                });

                return res.records.map(record => ({
                    id: record.get('id') as string,
                    name: record.get('name') as string,
                    type: (record.get('type') as string).toLowerCase(),
                    properties: JSON.parse((record.get('properties') as string) || '{}'),
                    scope: record.get('scope') as Scope,
                    scope_id: record.get('scope_id') as string || null
                }));
            });

            return result;
        } finally {
            await session.close();
        }
    }

    /** Validate that a relationship type contains only safe characters (letters, numbers, underscores) */
    private validateRelType(type: string): string {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(type)) {
            throw new Error(`Invalid relationship type: ${type}`);
        }
        return type;
    }

    async createRelationship(rel: RelationshipData): Promise<void> {
        const session = this.getSession();
        const safeType = this.validateRelType(rel.type);
        try {
            await session.executeWrite(async (tx: ManagedTransaction) => {
                await tx.run(
                    `MATCH (from {entity_id: $fromId})
                     MATCH (to {entity_id: $toId})
                     MERGE (from)-[r:${safeType}]->(to)
                     ON CREATE SET r.properties = $properties, r.createdAt = datetime()
                     ON MATCH SET r.properties = $properties, r.updatedAt = datetime()`,
                    {
                        fromId: rel.from_id,
                        toId: rel.to_id,
                        properties: JSON.stringify(rel.properties || {})
                    }
                );
            });
        } finally {
            await session.close();
        }
    }

    async runQuery(query: string, params: Record<string, unknown> = {}): Promise<unknown[]> {
        const session = this.getSession();
        try {
            const result = await session.executeRead(async (tx: ManagedTransaction) => {
                const res = await tx.run(query, params);
                return res.records.map(record => {
                    const obj: Record<string, unknown> = {};
                    for (const key of record.keys) {
                        const keyStr = String(key);
                        const value = record.get(keyStr);
                        if (value && typeof value === 'object') {
                            if ('properties' in value) {
                                obj[keyStr] = value.properties;
                            } else if ('low' in value && 'high' in value) {
                                obj[keyStr] = value.toNumber ? value.toNumber() : value.low;
                            } else {
                                obj[keyStr] = value;
                            }
                        } else {
                            obj[keyStr] = value;
                        }
                    }
                    return obj;
                });
            });
            return result;
        } finally {
            await session.close();
        }
    }

    async deleteEntity(entityId: string): Promise<void> {
        const session = this.getSession();
        try {
            await session.executeWrite(async (tx: ManagedTransaction) => {
                await tx.run(
                    `MATCH (n {entity_id: $entityId})
                     DETACH DELETE n`,
                    { entityId }
                );
            });
        } finally {
            await session.close();
        }
    }

    async deleteByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const session = this.getSession();
        try {
            await session.executeWrite(async (tx: ManagedTransaction) => {
                let query = `MATCH (n {scope: $scope`;
                if (scopeId) {
                    query += `, scope_id: $scopeId`;
                }
                query += `}) DETACH DELETE n`;

                await tx.run(query, { scope, scopeId: scopeId || '' });
            });
        } finally {
            await session.close();
        }
    }

    async createEntitiesBatch(entities: ScopedEntity[]): Promise<string[]> {
        const session = this.getSession();
        try {
            const ids = await session.executeWrite(async (tx: ManagedTransaction) => {
                const results: string[] = [];
                for (const entity of entities) {
                    const label = this.getLabel(entity.type);
                    const entityId = entity.id || crypto.randomUUID();
                    const nameNormalized = entity.name.toLowerCase().trim();

                    const res = await tx.run(
                        `MERGE (n:${label} {entity_id: $entityId})
                         ON CREATE SET
                            n.name = $name,
                            n.name_normalized = $nameNormalized,
                            n.scope = $scope,
                            n.scope_id = $scopeId,
                            n.properties = $properties,
                            n.createdAt = datetime()
                         ON MATCH SET
                            n.name = COALESCE($name, n.name),
                            n.name_normalized = COALESCE($nameNormalized, n.name_normalized),
                            n.properties = COALESCE($properties, n.properties),
                            n.updatedAt = datetime()
                         RETURN n.entity_id as id`,
                        {
                            entityId,
                            name: entity.name,
                            nameNormalized,
                            scope: entity.scope,
                            scopeId: entity.scope_id || '',
                            properties: JSON.stringify(entity.properties || {})
                        }
                    );
                    results.push(res.records[0]?.get('id') as string);
                }
                return results;
            });
            return ids;
        } finally {
            await session.close();
        }
    }

    async createRelationshipsBatch(rels: RelationshipData[]): Promise<void> {
        const session = this.getSession();
        try {
            await session.executeWrite(async (tx: ManagedTransaction) => {
                for (const rel of rels) {
                    const safeType = this.validateRelType(rel.type);
                    await tx.run(
                        `MATCH (from {entity_id: $fromId})
                         MATCH (to {entity_id: $toId})
                         MERGE (from)-[r:${safeType}]->(to)
                         ON CREATE SET r.properties = $properties, r.createdAt = datetime()
                         ON MATCH SET r.properties = $properties, r.updatedAt = datetime()`,
                        {
                            fromId: rel.from_id,
                            toId: rel.to_id,
                            properties: JSON.stringify(rel.properties || {})
                        }
                    );
                }
            });
        } finally {
            await session.close();
        }
    }

    async getRelationships(scopes: ScopeRef[], limit = 100): Promise<Array<{
        from_id: string;
        from_name: string;
        from_type: string;
        to_id: string;
        to_name: string;
        to_type: string;
        relationship: string;
        properties: Record<string, unknown>;
    }>> {
        const session = this.getSession();
        try {
            const result = await session.executeRead(async (tx: ManagedTransaction) => {
                const { condition, params: scopeParams } = this.buildScopeCondition('from', scopes, 'rel');
                let query = `
                    MATCH (from)-[r]->(to)
                `;
                if (condition) {
                    query += ` WHERE ${condition}`;
                }
                query += `
                    RETURN
                        from.entity_id as from_id,
                        from.name as from_name,
                        labels(from)[0] as from_type,
                        to.entity_id as to_id,
                        to.name as to_name,
                        labels(to)[0] as to_type,
                        type(r) as relationship,
                        r.properties as properties
                    LIMIT $limit
                `;

                const res = await tx.run(query, { limit: neo4j.int(limit), ...scopeParams });
                return res.records.map(record => ({
                    from_id: record.get('from_id') as string,
                    from_name: record.get('from_name') as string,
                    from_type: (record.get('from_type') as string).toLowerCase(),
                    to_id: record.get('to_id') as string,
                    to_name: record.get('to_name') as string,
                    to_type: (record.get('to_type') as string).toLowerCase(),
                    relationship: record.get('relationship') as string,
                    properties: JSON.parse((record.get('properties') as string) || '{}')
                }));
            });
            return result;
        } finally {
            await session.close();
        }
    }

    async isConnected(): Promise<boolean> {
        if (!this.driver) return false;
        try {
            await this.driver.verifyConnectivity();
            return true;
        } catch {
            return false;
        }
    }

    async getStats(): Promise<{ nodeCount: number; relationshipCount: number } | null> {
        const session = this.getSession();
        try {
            const result = await session.executeRead(async (tx: ManagedTransaction) => {
                const nodeRes = await tx.run('MATCH (n) RETURN count(n) as count');
                const relRes = await tx.run('MATCH ()-[r]->() RETURN count(r) as count');

                return {
                    nodeCount: nodeRes.records[0]?.get('count')?.toNumber() || 0,
                    relationshipCount: relRes.records[0]?.get('count')?.toNumber() || 0
                };
            });
            return result;
        } catch {
            return null;
        } finally {
            await session.close();
        }
    }
}
