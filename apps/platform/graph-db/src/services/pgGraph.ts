import { Pool } from 'pg';
import config from '../config/index.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';
import type {
    EntityType,
    GraphStore,
    GraphStoreStats,
    RelationshipData,
    RelationshipRow,
    ScopedEntity,
    SearchResult
} from './graphStore.js';

function validateRelType(type: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(type)) {
        throw new Error(`Invalid relationship type: ${type}`);
    }
    return type;
}

function scopeFilter(alias: string, scopes: ScopeRef[], paramStart: number): { sql: string; params: string[] } {
    if (scopes.length === 0) return { sql: '', params: [] };
    const params: string[] = [];
    const parts = scopes.map((s) => {
        if (s.scope === 'global') {
            params.push('global');
            return `${alias}.scope = $${paramStart + params.length - 1}`;
        }
        params.push(s.scope);
        params.push(s.scope_id ?? '');
        const a = paramStart + params.length - 2;
        const b = paramStart + params.length - 1;
        return `(${alias}.scope = $${a} AND ${alias}.scope_id = $${b})`;
    });
    return { sql: `(${parts.join(' OR ')})`, params };
}

export default class PgGraphService implements GraphStore {
    private pool: Pool | null = null;
    private initialized = false;

    async connect(): Promise<void> {
        if (this.pool) return;
        this.pool = new Pool({
            connectionString: config.postgres.url,
            max: config.postgres.pool_max
        });
        this.pool.on('error', (err) => console.error('[pgGraph] pool error:', err));
        await this.ensureSchema();
        console.log('[pgGraph] Connected');
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.initialized = false;
            console.log('[pgGraph] Disconnected');
        }
    }

    async isConnected(): Promise<boolean> {
        if (!this.pool) return false;
        try {
            const r = await this.pool.query('SELECT 1');
            return r.rowCount === 1;
        } catch {
            return false;
        }
    }

    private requirePool(): Pool {
        if (!this.pool) throw new Error('pgGraph not connected');
        return this.pool;
    }

    private async ensureSchema(): Promise<void> {
        if (this.initialized || !this.pool) return;
        const client = await this.pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS graph_nodes (
                    id text PRIMARY KEY,
                    name text NOT NULL,
                    name_normalized text NOT NULL,
                    type text NOT NULL,
                    scope text NOT NULL,
                    scope_id text,
                    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS graph_nodes_scope_idx ON graph_nodes (scope, scope_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS graph_nodes_type_idx ON graph_nodes (type)`);
            await client.query(`CREATE INDEX IF NOT EXISTS graph_nodes_name_normalized_trgm ON graph_nodes USING gin (name_normalized gin_trgm_ops)`)
                .catch(async () => {
                    // pg_trgm may not be enabled; try to enable it then re-create.
                    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
                    await client.query(`CREATE INDEX IF NOT EXISTS graph_nodes_name_normalized_trgm ON graph_nodes USING gin (name_normalized gin_trgm_ops)`);
                });

            await client.query(`
                CREATE TABLE IF NOT EXISTS graph_edges (
                    src_id text NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
                    dst_id text NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
                    type text NOT NULL,
                    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (src_id, dst_id, type)
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS graph_edges_src_type_idx ON graph_edges (src_id, type)`);
            await client.query(`CREATE INDEX IF NOT EXISTS graph_edges_dst_type_idx ON graph_edges (dst_id, type)`);

            this.initialized = true;
            console.log('[pgGraph] Schema ready');
        } finally {
            client.release();
        }
    }

    async createOrUpdateEntity(entity: ScopedEntity): Promise<string> {
        const pool = this.requirePool();
        const id = entity.id || crypto.randomUUID();
        const nameNormalized = entity.name.toLowerCase().trim();
        await pool.query(
            `INSERT INTO graph_nodes (id, name, name_normalized, type, scope, scope_id, properties)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                name_normalized = EXCLUDED.name_normalized,
                properties = EXCLUDED.properties,
                updated_at = now()`,
            [id, entity.name, nameNormalized, entity.type, entity.scope, entity.scope_id, JSON.stringify(entity.properties || {})]
        );
        return id;
    }

    async createEntitiesBatch(entities: ScopedEntity[]): Promise<string[]> {
        if (entities.length === 0) return [];
        const pool = this.requirePool();
        const client = await pool.connect();
        const ids: string[] = [];
        try {
            await client.query('BEGIN');
            for (const e of entities) {
                const id = e.id || crypto.randomUUID();
                const nameNormalized = e.name.toLowerCase().trim();
                await client.query(
                    `INSERT INTO graph_nodes (id, name, name_normalized, type, scope, scope_id, properties)
                     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                     ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        name_normalized = EXCLUDED.name_normalized,
                        properties = EXCLUDED.properties,
                        updated_at = now()`,
                    [id, e.name, nameNormalized, e.type, e.scope, e.scope_id, JSON.stringify(e.properties || {})]
                );
                ids.push(id);
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
        return ids;
    }

    async getEntity(entityId: string, scopes?: ScopeRef[]): Promise<SearchResult | null> {
        const pool = this.requirePool();
        const params: unknown[] = [entityId];
        let where = 'WHERE id = $1';
        if (scopes && scopes.length > 0) {
            const f = scopeFilter('graph_nodes', scopes, params.length + 1);
            if (f.sql) {
                where += ` AND ${f.sql}`;
                params.push(...f.params);
            }
        }
        const r = await pool.query(
            `SELECT id, name, type, properties, scope, scope_id FROM graph_nodes ${where} LIMIT 1`,
            params
        );
        if (r.rowCount === 0) return null;
        const row = r.rows[0];
        return {
            id: row.id,
            name: row.name,
            type: row.type,
            properties: row.properties || {},
            scope: row.scope as Scope,
            scope_id: row.scope_id || null
        };
    }

    async searchEntities(
        query: string,
        scopes: ScopeRef[],
        entityType?: EntityType,
        limit = 10
    ): Promise<SearchResult[]> {
        const pool = this.requirePool();
        const params: unknown[] = [query.toLowerCase()];
        const wheres: string[] = ['name_normalized % $1'];
        const scope = scopeFilter('graph_nodes', scopes, params.length + 1);
        if (scope.sql) {
            wheres.push(scope.sql);
            params.push(...scope.params);
        }
        if (entityType) {
            params.push(entityType);
            wheres.push(`type = $${params.length}`);
        }
        params.push(limit);
        const sql = `
            SELECT id, name, type, properties, scope, scope_id,
                   similarity(name_normalized, $1) AS score
            FROM graph_nodes
            WHERE ${wheres.join(' AND ')}
            ORDER BY score DESC
            LIMIT $${params.length}
        `;
        try {
            const r = await pool.query(sql, params);
            return r.rows.map((row) => ({
                id: row.id,
                name: row.name,
                type: row.type,
                properties: row.properties || {},
                score: Number(row.score),
                scope: row.scope as Scope,
                scope_id: row.scope_id || null
            }));
        } catch (err) {
            // pg_trgm not available — fall back to ILIKE CONTAINS.
            console.warn('[pgGraph] trigram search unavailable, falling back to ILIKE:', err);
            return this.searchEntitiesFallback(query, scopes, entityType, limit);
        }
    }

    private async searchEntitiesFallback(
        query: string,
        scopes: ScopeRef[],
        entityType?: EntityType,
        limit = 10
    ): Promise<SearchResult[]> {
        const pool = this.requirePool();
        const params: unknown[] = [`%${query.toLowerCase()}%`];
        const wheres: string[] = ['name_normalized LIKE $1'];
        const scope = scopeFilter('graph_nodes', scopes, params.length + 1);
        if (scope.sql) {
            wheres.push(scope.sql);
            params.push(...scope.params);
        }
        if (entityType) {
            params.push(entityType);
            wheres.push(`type = $${params.length}`);
        }
        params.push(limit);
        const sql = `
            SELECT id, name, type, properties, scope, scope_id
            FROM graph_nodes
            WHERE ${wheres.join(' AND ')}
            LIMIT $${params.length}
        `;
        const r = await pool.query(sql, params);
        return r.rows.map((row) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            properties: row.properties || {},
            scope: row.scope as Scope,
            scope_id: row.scope_id || null
        }));
    }

    async deleteEntity(entityId: string): Promise<void> {
        await this.requirePool().query('DELETE FROM graph_nodes WHERE id = $1', [entityId]);
    }

    async deleteByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const pool = this.requirePool();
        if (scopeId === null) {
            await pool.query('DELETE FROM graph_nodes WHERE scope = $1', [scope]);
        } else {
            await pool.query('DELETE FROM graph_nodes WHERE scope = $1 AND scope_id = $2', [scope, scopeId]);
        }
    }

    async createRelationship(rel: RelationshipData): Promise<void> {
        const pool = this.requirePool();
        const type = validateRelType(rel.type);
        await pool.query(
            `INSERT INTO graph_edges (src_id, dst_id, type, properties)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (src_id, dst_id, type) DO UPDATE SET
                properties = EXCLUDED.properties,
                updated_at = now()`,
            [rel.from_id, rel.to_id, type, JSON.stringify(rel.properties || {})]
        );
    }

    async createRelationshipsBatch(rels: RelationshipData[]): Promise<void> {
        if (rels.length === 0) return;
        const pool = this.requirePool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const rel of rels) {
                const type = validateRelType(rel.type);
                await client.query(
                    `INSERT INTO graph_edges (src_id, dst_id, type, properties)
                     VALUES ($1, $2, $3, $4::jsonb)
                     ON CONFLICT (src_id, dst_id, type) DO UPDATE SET
                        properties = EXCLUDED.properties,
                        updated_at = now()`,
                    [rel.from_id, rel.to_id, type, JSON.stringify(rel.properties || {})]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getRelationships(scopes: ScopeRef[], limit = 100): Promise<RelationshipRow[]> {
        const pool = this.requirePool();
        const params: unknown[] = [];
        const scope = scopeFilter('s', scopes, params.length + 1);
        if (scope.sql) params.push(...scope.params);
        params.push(limit);
        const whereSql = scope.sql ? `WHERE ${scope.sql}` : '';
        const sql = `
            SELECT
                s.id AS from_id, s.name AS from_name, s.type AS from_type,
                d.id AS to_id, d.name AS to_name, d.type AS to_type,
                e.type AS relationship, e.properties AS properties
            FROM graph_edges e
            JOIN graph_nodes s ON s.id = e.src_id
            JOIN graph_nodes d ON d.id = e.dst_id
            ${whereSql}
            LIMIT $${params.length}
        `;
        const r = await pool.query(sql, params);
        return r.rows.map((row) => ({
            from_id: row.from_id,
            from_name: row.from_name,
            from_type: row.from_type,
            to_id: row.to_id,
            to_name: row.to_name,
            to_type: row.to_type,
            relationship: row.relationship,
            properties: row.properties || {}
        }));
    }

    async runQuery(_query: string, _params: Record<string, unknown> = {}): Promise<unknown[]> {
        // The Cypher endpoint is intentionally not supported on the Postgres
        // backend — callers using raw Cypher need Neo4j. Returning [] mirrors a
        // "no results" rather than crashing the route; the API layer should
        // refuse to expose this endpoint when running on pg.
        throw new Error('Cypher queries are not supported on the Postgres graph backend');
    }

    async getStats(): Promise<GraphStoreStats | null> {
        const pool = this.requirePool();
        try {
            const n = await pool.query('SELECT count(*)::int AS n FROM graph_nodes');
            const e = await pool.query('SELECT count(*)::int AS n FROM graph_edges');
            return {
                nodeCount: n.rows[0]?.n ?? 0,
                relationshipCount: e.rows[0]?.n ?? 0
            };
        } catch {
            return null;
        }
    }
}
