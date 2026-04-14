import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import MilvusService from '../services/milvus.js';
import EmbeddingService from '../services/embedding.js';
import type { UsageContext } from '../services/embedding.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';

const router: express.Router = Router();
const milvusService = new MilvusService();
const embeddingService = new EmbeddingService();

// Initialize Milvus connection
milvusService.connect().catch(err => {
    console.error('[API] Failed to connect to Milvus:', err);
});

// Extract usage context from request headers
function getUsageContext(req: Request): UsageContext {
    return {
        org_id: req.headers['x-org-id'] as string | undefined,
        user_id: req.headers['x-user-id'] as string | undefined,
        agent_id: req.headers['x-agent-id'] as string | undefined
    };
}

// Validation schemas
const ScopeRefSchema = z.object({
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const SearchRequestSchema = z.object({
    query: z.string().min(1),
    scopes: z.array(ScopeRefSchema).min(1),
    collection: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional().default(10),
    embedding: z.array(z.number()).optional(),
    data_type: z.string().optional()
});

const EmbeddingUpsertSchema = z.object({
    id: z.string().optional(),
    content: z.string().min(1),
    embedding: z.array(z.number()).optional(),
    metadata: z.record(z.unknown()).optional(),
    data_type: z.string().optional(),
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const DocumentChunkSchema = z.object({
    id: z.string(),
    chunk_id: z.string(),
    document_id: z.string(),
    content: z.string(),
    chunk_index: z.number().int(),
    metadata: z.record(z.unknown()).optional(),
    embedding: z.array(z.number()).optional(),
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const IngestRequestSchema = z.object({
    content: z.string().min(1),
    source_type: z.enum(['file', 'url', 'text']),
    source_name: z.string(),
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable(),
    metadata: z.record(z.unknown()).optional()
});

// POST /api/v1/search - Multi-scope vector search
router.post('/v1/search', async (req: Request, res: Response) => {
    try {
        const body = SearchRequestSchema.parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!embeddingService.isConfigured()) {
                res.status(400).json({
                    success: false,
                    error: 'Embedding service not configured. Provide embedding in request.'
                });
                return;
            }
            embedding = await embeddingService.generateEmbedding(body.query, getUsageContext(req));
        }

        const results = await milvusService.search(
            embedding,
            body.scopes as ScopeRef[],
            body.limit,
            body.data_type
        );

        res.json({
            success: true,
            data: results,
            query: body.query
        });
    } catch (error) {
        console.error('[API] Search error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// POST /api/v1/embeddings - Upsert embedding
router.post('/v1/embeddings', async (req: Request, res: Response) => {
    try {
        const body = EmbeddingUpsertSchema.parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!embeddingService.isConfigured()) {
                res.status(400).json({
                    success: false,
                    error: 'Embedding service not configured. Provide embedding in request.'
                });
                return;
            }
            embedding = await embeddingService.generateEmbedding(body.content, getUsageContext(req));
        }

        const id = body.id || crypto.randomUUID();

        await milvusService.upsertEmbedding({
            id,
            content: body.content,
            embedding,
            metadata: body.metadata,
            data_type: body.data_type,
            scope: body.scope as Scope,
            scope_id: body.scope_id
        });

        res.status(201).json({
            success: true,
            data: { id }
        });
    } catch (error) {
        console.error('[API] Upsert error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Upsert failed' });
    }
});

// DELETE /api/v1/embeddings/:id - Delete embedding
router.delete('/v1/embeddings/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await milvusService.deleteById(id as string);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete error:', error);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// POST /api/v1/documents/:id/chunks - Upsert document chunks
router.post('/v1/documents/:id/chunks', async (req: Request, res: Response) => {
    try {
        const { id: documentId } = req.params as { id: string };
        const chunks = z.array(DocumentChunkSchema).parse(req.body.chunks);

        // Generate embeddings for chunks that don't have them
        const chunksToEmbed = chunks.filter(c => !c.embedding);
        let embeddings: number[][] = [];

        if (chunksToEmbed.length > 0) {
            if (!embeddingService.isConfigured()) {
                res.status(400).json({
                    success: false,
                    error: 'Embedding service not configured. Provide embeddings in request.'
                });
                return;
            }
            embeddings = await embeddingService.generateEmbeddings(
                chunksToEmbed.map(c => c.content),
                getUsageContext(req)
            );
        }

        let embeddingIdx = 0;
        const processedChunks = chunks.map(chunk => ({
            id: chunk.id,
            chunk_id: chunk.chunk_id,
            document_id: documentId,
            content: chunk.content,
            chunk_index: chunk.chunk_index,
            metadata: JSON.stringify(chunk.metadata || {}),
            embedding: chunk.embedding || embeddings[embeddingIdx++],
            scope: chunk.scope as Scope,
            scope_id: chunk.scope_id
        }));

        await milvusService.upsertDocumentChunks(processedChunks);

        res.status(201).json({
            success: true,
            data: { document_id: documentId, chunk_count: processedChunks.length }
        });
    } catch (error) {
        console.error('[API] Document chunks error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Chunk upsert failed' });
    }
});

// DELETE /api/v1/documents/:id/chunks - Delete all chunks for a document
router.delete('/v1/documents/:id/chunks', async (req: Request, res: Response) => {
    try {
        const { id: documentId } = req.params;
        await milvusService.deleteDocumentChunks(documentId as string);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete chunks error:', error);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// POST /api/v1/documents/search - Search document chunks
router.post('/v1/documents/search', async (req: Request, res: Response) => {
    try {
        const body = SearchRequestSchema.extend({
            document_id: z.string().optional()
        }).parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!embeddingService.isConfigured()) {
                res.status(400).json({
                    success: false,
                    error: 'Embedding service not configured. Provide embedding in request.'
                });
                return;
            }
            embedding = await embeddingService.generateEmbedding(body.query, getUsageContext(req));
        }

        const results = await milvusService.searchDocumentChunks(
            embedding,
            body.scopes as ScopeRef[],
            body.document_id,
            body.limit
        );

        res.json({
            success: true,
            data: results,
            query: body.query
        });
    } catch (error) {
        console.error('[API] Document search error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// POST /api/v1/knowledge-base/ingest - Ingest content to knowledge base
router.post('/v1/knowledge-base/ingest', async (req: Request, res: Response) => {
    try {
        const body = IngestRequestSchema.parse(req.body);

        // Check for admin role if scope is global
        if (body.scope === 'global') {
            // In production, check for admin role from auth middleware
            // For now, allow it but log a warning
            console.warn('[API] Global scope ingest - ensure admin authorization');
        }

        if (!embeddingService.isConfigured()) {
            res.status(400).json({
                success: false,
                error: 'Embedding service not configured. Cannot ingest content.'
            });
            return;
        }

        // Simple chunking: split by paragraphs or fixed size
        const chunks = chunkContent(body.content, 1000, 200);
        const embeddings = await embeddingService.generateEmbeddings(chunks, getUsageContext(req));

        const documentId = crypto.randomUUID();
        const processedChunks = chunks.map((content, idx) => ({
            id: crypto.randomUUID(),
            chunk_id: crypto.randomUUID(),
            document_id: documentId,
            content,
            chunk_index: idx,
            metadata: JSON.stringify({
                source_type: body.source_type,
                source_name: body.source_name,
                ...body.metadata
            }),
            embedding: embeddings[idx],
            scope: body.scope as Scope,
            scope_id: body.scope_id
        }));

        await milvusService.upsertDocumentChunks(processedChunks);

        res.status(201).json({
            success: true,
            data: {
                document_id: documentId,
                chunk_count: processedChunks.length,
                scope: body.scope,
                scope_id: body.scope_id
            }
        });
    } catch (error) {
        console.error('[API] Ingest error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Ingest failed' });
    }
});

// POST /api/v1/embeddings/batch - Batch upsert embeddings
router.post('/v1/embeddings/batch', async (req: Request, res: Response) => {
    try {
        const items = z.array(EmbeddingUpsertSchema).parse(req.body.items);
        const ctx = getUsageContext(req);

        const processedItems = [];
        for (const item of items) {
            let embedding = item.embedding;
            if (!embedding) {
                if (!embeddingService.isConfigured()) {
                    res.status(400).json({
                        success: false,
                        error: 'Embedding service not configured. Provide embeddings in request.'
                    });
                    return;
                }
                embedding = await embeddingService.generateEmbedding(item.content, ctx);
            }

            processedItems.push({
                id: item.id || crypto.randomUUID(),
                content: item.content,
                embedding,
                metadata: item.metadata,
                data_type: item.data_type,
                scope: item.scope as Scope,
                scope_id: item.scope_id
            });
        }

        await milvusService.upsertEmbeddings(processedItems);

        res.status(201).json({
            success: true,
            data: { count: processedItems.length }
        });
    } catch (error) {
        console.error('[API] Batch upsert error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Batch upsert failed' });
    }
});

// DELETE /api/v1/embeddings/by-scope - Delete embeddings by scope
router.delete('/v1/embeddings/by-scope', async (req: Request, res: Response) => {
    try {
        const body = z.object({
            scope: z.enum(['global', 'org', 'agent']),
            scope_id: z.string().nullable()
        }).parse(req.body);

        await milvusService.deleteByScope(body.scope as Scope, body.scope_id);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete by scope error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Delete by scope failed' });
    }
});

// POST /api/v1/documents/summaries - Upsert document summary
router.post('/v1/documents/summaries', async (req: Request, res: Response) => {
    try {
        const body = z.object({
            id: z.string().optional(),
            document_id: z.string(),
            content: z.string().min(1),
            topic: z.string().optional().default(''),
            metadata: z.record(z.unknown()).optional(),
            embedding: z.array(z.number()).optional(),
            scope: z.enum(['global', 'org', 'agent']),
            scope_id: z.string().nullable()
        }).parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!embeddingService.isConfigured()) {
                res.status(400).json({
                    success: false,
                    error: 'Embedding service not configured. Provide embedding in request.'
                });
                return;
            }
            embedding = await embeddingService.generateEmbedding(body.content, getUsageContext(req));
        }

        const id = body.id || crypto.randomUUID();

        await milvusService.upsertDocumentSummary({
            id,
            document_id: body.document_id,
            content: body.content,
            topic: body.topic,
            metadata: JSON.stringify(body.metadata || {}),
            embedding,
            scope: body.scope as Scope,
            scope_id: body.scope_id
        });

        res.status(201).json({
            success: true,
            data: { id, document_id: body.document_id }
        });
    } catch (error) {
        console.error('[API] Document summary upsert error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Document summary upsert failed' });
    }
});

// POST /api/v1/documents/summaries/search - Search document summaries
router.post('/v1/documents/summaries/search', async (req: Request, res: Response) => {
    try {
        const body = SearchRequestSchema.parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!embeddingService.isConfigured()) {
                res.status(400).json({
                    success: false,
                    error: 'Embedding service not configured. Provide embedding in request.'
                });
                return;
            }
            embedding = await embeddingService.generateEmbedding(body.query, getUsageContext(req));
        }

        const results = await milvusService.searchDocumentSummaries(
            embedding,
            body.scopes as ScopeRef[],
            body.limit
        );

        res.json({
            success: true,
            data: results,
            query: body.query
        });
    } catch (error) {
        console.error('[API] Document summary search error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// DELETE /api/v1/documents/:id/summary - Delete document summary
router.delete('/v1/documents/:id/summary', async (req: Request, res: Response) => {
    try {
        const { id: documentId } = req.params;
        await milvusService.deleteDocumentSummary(documentId as string);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete document summary error:', error);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// DELETE /api/v1/documents/summaries/by-scope - Delete document summaries by scope
router.delete('/v1/documents/summaries/by-scope', async (req: Request, res: Response) => {
    try {
        const body = z.object({
            scope: z.enum(['global', 'org', 'agent']),
            scope_id: z.string().nullable()
        }).parse(req.body);

        await milvusService.deleteDocumentSummariesByScope(body.scope as Scope, body.scope_id);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete summaries by scope error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Delete by scope failed' });
    }
});

// DELETE /api/v1/documents/chunks/by-scope - Delete document chunks by scope
router.delete('/v1/documents/chunks/by-scope', async (req: Request, res: Response) => {
    try {
        const body = z.object({
            scope: z.enum(['global', 'org', 'agent']),
            scope_id: z.string().nullable()
        }).parse(req.body);

        await milvusService.deleteDocumentChunksByScope(body.scope as Scope, body.scope_id);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete chunks by scope error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Delete by scope failed' });
    }
});

// GET /api/v1/stats - Collection statistics
router.get('/v1/stats', async (_req: Request, res: Response) => {
    try {
        const stats = await milvusService.getStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('[API] Stats error:', error);
        res.status(500).json({ success: false, error: 'Stats failed' });
    }
});

// Simple content chunking function
function chunkContent(content: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    const words = content.split(/\s+/);

    let start = 0;
    while (start < words.length) {
        const end = Math.min(start + chunkSize, words.length);
        chunks.push(words.slice(start, end).join(' '));
        start = end - overlap;
        if (start >= words.length) break;
    }

    return chunks;
}

export default router;
