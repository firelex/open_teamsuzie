import { Pool, type PoolClient } from 'pg';
import config from '../config/index.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';
import type {
    DocumentChunkEmbedding,
    DocumentChunkSearchResult,
    DocumentSummaryEmbedding,
    DocumentSummarySearchResult,
    ScopedEmbedding,
    ScopedSearchResult
} from './milvus.js';
import type { VectorStore, VectorStoreStats } from './vectorStore.js';

function tableSuffix(profileId: string): string {
    return profileId.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'default';
}

function toVectorLiteral(v: number[]): string {
    return `[${v.join(',')}]`;
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

export default class PgVectorService implements VectorStore {
    private pool: Pool | null = null;
    private readonly mainTable: string;
    private readonly chunksTable: string;
    private readonly summariesTable: string;
    private readonly dimension: number;
    private initialized = false;

    constructor() {
        const suffix = tableSuffix(config.postgres.table_suffix || config.embedding.profile_id);
        this.mainTable = `scoped_embeddings_${suffix}`;
        this.chunksTable = `document_chunks_${suffix}`;
        this.summariesTable = `document_summaries_${suffix}`;
        this.dimension = config.postgres.dimension;
    }

    async connect(): Promise<void> {
        if (this.pool) return;
        this.pool = new Pool({
            connectionString: config.postgres.url,
            max: config.postgres.pool_max
        });
        // surface pool errors instead of crashing
        this.pool.on('error', (err) => console.error('[pgvector] pool error:', err));
        await this.ensureSchema();
        console.log('[pgvector] Connected');
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.initialized = false;
            console.log('[pgvector] Disconnected');
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

    private async ensureSchema(): Promise<void> {
        if (this.initialized || !this.pool) return;
        const dim = this.dimension;
        const client = await this.pool.connect();
        try {
            await client.query('CREATE EXTENSION IF NOT EXISTS vector');

            await client.query(`
                CREATE TABLE IF NOT EXISTS ${this.mainTable} (
                    id text PRIMARY KEY,
                    content text NOT NULL,
                    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
                    data_type text,
                    scope text NOT NULL,
                    scope_id text,
                    embedding vector(${dim}) NOT NULL
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.mainTable}_scope_idx ON ${this.mainTable} (scope, scope_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.mainTable}_data_type_idx ON ${this.mainTable} (data_type)`);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.mainTable}_embedding_idx ON ${this.mainTable} USING hnsw (embedding vector_cosine_ops)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS ${this.chunksTable} (
                    id text PRIMARY KEY,
                    chunk_id text NOT NULL,
                    document_id text NOT NULL,
                    content text NOT NULL,
                    chunk_index integer NOT NULL,
                    metadata text NOT NULL DEFAULT '{}',
                    scope text NOT NULL,
                    scope_id text,
                    embedding vector(${dim}) NOT NULL
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.chunksTable}_scope_idx ON ${this.chunksTable} (scope, scope_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.chunksTable}_document_idx ON ${this.chunksTable} (document_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.chunksTable}_embedding_idx ON ${this.chunksTable} USING hnsw (embedding vector_cosine_ops)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS ${this.summariesTable} (
                    id text PRIMARY KEY,
                    document_id text NOT NULL,
                    content text NOT NULL,
                    topic text NOT NULL DEFAULT '',
                    metadata text NOT NULL DEFAULT '{}',
                    scope text NOT NULL,
                    scope_id text,
                    embedding vector(${dim}) NOT NULL
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.summariesTable}_scope_idx ON ${this.summariesTable} (scope, scope_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.summariesTable}_document_idx ON ${this.summariesTable} (document_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS ${this.summariesTable}_embedding_idx ON ${this.summariesTable} USING hnsw (embedding vector_cosine_ops)`);

            this.initialized = true;
            console.log(`[pgvector] Ensured tables ${this.mainTable}, ${this.chunksTable}, ${this.summariesTable} (dim=${dim})`);
        } finally {
            client.release();
        }
    }

    private requirePool(): Pool {
        if (!this.pool) throw new Error('pgvector not connected');
        return this.pool;
    }

    async upsertEmbedding(data: ScopedEmbedding): Promise<void> {
        const pool = this.requirePool();
        await pool.query(
            `INSERT INTO ${this.mainTable} (id, content, metadata, data_type, scope, scope_id, embedding)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::vector)
             ON CONFLICT (id) DO UPDATE SET
                content = EXCLUDED.content,
                metadata = EXCLUDED.metadata,
                data_type = EXCLUDED.data_type,
                scope = EXCLUDED.scope,
                scope_id = EXCLUDED.scope_id,
                embedding = EXCLUDED.embedding`,
            [
                data.id,
                data.content,
                JSON.stringify(data.metadata || {}),
                data.data_type || null,
                data.scope,
                data.scope_id,
                toVectorLiteral(data.embedding)
            ]
        );
    }

    async upsertEmbeddings(data: ScopedEmbedding[]): Promise<void> {
        if (data.length === 0) return;
        const pool = this.requirePool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const d of data) {
                await client.query(
                    `INSERT INTO ${this.mainTable} (id, content, metadata, data_type, scope, scope_id, embedding)
                     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::vector)
                     ON CONFLICT (id) DO UPDATE SET
                        content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata,
                        data_type = EXCLUDED.data_type,
                        scope = EXCLUDED.scope,
                        scope_id = EXCLUDED.scope_id,
                        embedding = EXCLUDED.embedding`,
                    [
                        d.id,
                        d.content,
                        JSON.stringify(d.metadata || {}),
                        d.data_type || null,
                        d.scope,
                        d.scope_id,
                        toVectorLiteral(d.embedding)
                    ]
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

    async search(
        embedding: number[],
        scopes: ScopeRef[],
        topK = 10,
        dataType?: string
    ): Promise<ScopedSearchResult[]> {
        const pool = this.requirePool();
        const params: unknown[] = [toVectorLiteral(embedding)];
        const wheres: string[] = [];
        const scope = scopeFilter('t', scopes, params.length + 1);
        if (scope.sql) {
            wheres.push(scope.sql);
            params.push(...scope.params);
        }
        if (dataType) {
            params.push(dataType);
            wheres.push(`t.data_type = $${params.length}`);
        }
        params.push(topK);
        const limitParam = params.length;
        const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
        const sql = `
            SELECT id, content, metadata, data_type, scope, scope_id,
                   1 - (embedding <=> $1::vector) AS score
            FROM ${this.mainTable} t
            ${whereSql}
            ORDER BY embedding <=> $1::vector
            LIMIT $${limitParam}
        `;
        const r = await pool.query(sql, params);
        return r.rows.map((row) => ({
            id: row.id,
            content: row.content,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
            data_type: row.data_type || undefined,
            score: Number(row.score),
            scope: row.scope as Scope,
            scope_id: row.scope_id || null
        }));
    }

    async deleteById(id: string): Promise<void> {
        await this.requirePool().query(`DELETE FROM ${this.mainTable} WHERE id = $1`, [id]);
    }

    async deleteByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const pool = this.requirePool();
        if (scopeId === null) {
            await pool.query(`DELETE FROM ${this.mainTable} WHERE scope = $1`, [scope]);
        } else {
            await pool.query(`DELETE FROM ${this.mainTable} WHERE scope = $1 AND scope_id = $2`, [scope, scopeId]);
        }
    }

    async upsertDocumentChunk(data: DocumentChunkEmbedding): Promise<void> {
        const pool = this.requirePool();
        await this.upsertChunkOn(pool, data);
    }

    async upsertDocumentChunks(data: DocumentChunkEmbedding[]): Promise<void> {
        if (data.length === 0) return;
        const pool = this.requirePool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const d of data) await this.upsertChunkOn(client, d);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    private async upsertChunkOn(runner: Pool | PoolClient, d: DocumentChunkEmbedding): Promise<void> {
        await runner.query(
            `INSERT INTO ${this.chunksTable} (id, chunk_id, document_id, content, chunk_index, metadata, scope, scope_id, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
             ON CONFLICT (id) DO UPDATE SET
                chunk_id = EXCLUDED.chunk_id,
                document_id = EXCLUDED.document_id,
                content = EXCLUDED.content,
                chunk_index = EXCLUDED.chunk_index,
                metadata = EXCLUDED.metadata,
                scope = EXCLUDED.scope,
                scope_id = EXCLUDED.scope_id,
                embedding = EXCLUDED.embedding`,
            [
                d.id,
                d.chunk_id,
                d.document_id,
                d.content,
                d.chunk_index,
                d.metadata,
                d.scope,
                d.scope_id,
                toVectorLiteral(d.embedding)
            ]
        );
    }

    async searchDocumentChunks(
        embedding: number[],
        scopes: ScopeRef[],
        documentId?: string,
        topK = 10
    ): Promise<DocumentChunkSearchResult[]> {
        const pool = this.requirePool();
        const params: unknown[] = [toVectorLiteral(embedding)];
        const wheres: string[] = [];
        const scope = scopeFilter('t', scopes, params.length + 1);
        if (scope.sql) {
            wheres.push(scope.sql);
            params.push(...scope.params);
        }
        if (documentId) {
            params.push(documentId);
            wheres.push(`t.document_id = $${params.length}`);
        }
        params.push(topK);
        const limitParam = params.length;
        const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
        const sql = `
            SELECT id, chunk_id, document_id, content, chunk_index, metadata, scope, scope_id,
                   1 - (embedding <=> $1::vector) AS score
            FROM ${this.chunksTable} t
            ${whereSql}
            ORDER BY embedding <=> $1::vector
            LIMIT $${limitParam}
        `;
        const r = await pool.query(sql, params);
        return r.rows.map((row) => ({
            id: row.id,
            chunk_id: row.chunk_id,
            document_id: row.document_id,
            content: row.content,
            chunk_index: row.chunk_index,
            metadata: row.metadata,
            score: Number(row.score),
            scope: row.scope as Scope,
            scope_id: row.scope_id || null
        }));
    }

    async deleteDocumentChunks(documentId: string): Promise<void> {
        await this.requirePool().query(`DELETE FROM ${this.chunksTable} WHERE document_id = $1`, [documentId]);
    }

    async deleteDocumentChunksByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const pool = this.requirePool();
        if (scopeId === null) {
            await pool.query(`DELETE FROM ${this.chunksTable} WHERE scope = $1`, [scope]);
        } else {
            await pool.query(`DELETE FROM ${this.chunksTable} WHERE scope = $1 AND scope_id = $2`, [scope, scopeId]);
        }
    }

    async upsertDocumentSummary(data: DocumentSummaryEmbedding): Promise<void> {
        const pool = this.requirePool();
        await pool.query(
            `INSERT INTO ${this.summariesTable} (id, document_id, content, topic, metadata, scope, scope_id, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
             ON CONFLICT (id) DO UPDATE SET
                document_id = EXCLUDED.document_id,
                content = EXCLUDED.content,
                topic = EXCLUDED.topic,
                metadata = EXCLUDED.metadata,
                scope = EXCLUDED.scope,
                scope_id = EXCLUDED.scope_id,
                embedding = EXCLUDED.embedding`,
            [
                data.id,
                data.document_id,
                data.content,
                data.topic,
                data.metadata,
                data.scope,
                data.scope_id,
                toVectorLiteral(data.embedding)
            ]
        );
    }

    async searchDocumentSummaries(
        embedding: number[],
        scopes: ScopeRef[],
        topK = 10
    ): Promise<DocumentSummarySearchResult[]> {
        const pool = this.requirePool();
        const params: unknown[] = [toVectorLiteral(embedding)];
        const wheres: string[] = [];
        const scope = scopeFilter('t', scopes, params.length + 1);
        if (scope.sql) {
            wheres.push(scope.sql);
            params.push(...scope.params);
        }
        params.push(topK);
        const limitParam = params.length;
        const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
        const sql = `
            SELECT id, document_id, content, topic, metadata, scope, scope_id,
                   1 - (embedding <=> $1::vector) AS score
            FROM ${this.summariesTable} t
            ${whereSql}
            ORDER BY embedding <=> $1::vector
            LIMIT $${limitParam}
        `;
        const r = await pool.query(sql, params);
        return r.rows.map((row) => ({
            id: row.id,
            document_id: row.document_id,
            content: row.content,
            topic: row.topic,
            metadata: row.metadata,
            score: Number(row.score),
            scope: row.scope as Scope,
            scope_id: row.scope_id || null
        }));
    }

    async deleteDocumentSummary(documentId: string): Promise<void> {
        await this.requirePool().query(`DELETE FROM ${this.summariesTable} WHERE document_id = $1`, [documentId]);
    }

    async deleteDocumentSummariesByScope(scope: Scope, scopeId: string | null): Promise<void> {
        const pool = this.requirePool();
        if (scopeId === null) {
            await pool.query(`DELETE FROM ${this.summariesTable} WHERE scope = $1`, [scope]);
        } else {
            await pool.query(`DELETE FROM ${this.summariesTable} WHERE scope = $1 AND scope_id = $2`, [scope, scopeId]);
        }
    }

    async getStats(): Promise<VectorStoreStats | null> {
        const pool = this.requirePool();
        try {
            const main = await pool.query(`SELECT count(*)::int AS n FROM ${this.mainTable}`);
            const chunks = await pool.query(`SELECT count(*)::int AS n FROM ${this.chunksTable}`);
            return {
                mainCount: main.rows[0]?.n ?? 0,
                chunksCount: chunks.rows[0]?.n ?? 0
            };
        } catch {
            return null;
        }
    }
}
