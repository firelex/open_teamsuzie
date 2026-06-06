import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createVectorStore } from '../services/storeFactory.js';
import EmbeddingService from '../services/embedding.js';
import type { EmbeddingInput, UsageContext } from '../services/embedding.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';

const router: express.Router = Router();
const vectorStore = createVectorStore();
const embeddingService = new EmbeddingService();

// Initialize vector store connection
vectorStore.connect().catch(err => {
    console.error('[API] Failed to connect to vector store:', err);
});

// Extract usage context from request headers
function getUsageContext(req: Request): UsageContext {
    return {
        org_id: req.headers['x-org-id'] as string | undefined,
        user_id: req.headers['x-user-id'] as string | undefined,
        agent_id: req.headers['x-agent-id'] as string | undefined
    };
}

function mediaValues(body: { media_base64?: string | string[]; image_base64?: string | string[] }): string[] | undefined {
    const values = body.media_base64 ?? body.image_base64;
    if (!values) return undefined;
    return Array.isArray(values) ? values : [values];
}

function embeddingInput(text: string, body: { media_base64?: string | string[]; image_base64?: string | string[] }): EmbeddingInput {
    return {
        text,
        mediaBase64: mediaValues(body)
    };
}

function ensureEmbeddingConfigured(res: Response, profileId?: string, action = 'Provide embedding in request.'): boolean {
    if (embeddingService.isConfigured(profileId)) return true;
    res.status(400).json({
        success: false,
        error: `Embedding profile not configured. ${action}`
    });
    return false;
}

function singleProfile(items: Array<{ embedding_profile?: string }>, fallback?: string): string | undefined {
    const profiles = new Set(items.map((item) => item.embedding_profile || fallback).filter(Boolean));
    if (profiles.size > 1) {
        throw new Error('All items in one embedding batch must use the same embedding_profile.');
    }
    return profiles.values().next().value;
}

// Validation schemas
const ScopeRefSchema = z.object({
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const MediaBase64Schema = z.union([z.string(), z.array(z.string())]).optional();

const SearchFieldsSchema = z.object({
    query: z.string().min(1).optional(),
    scopes: z.array(ScopeRefSchema).min(1),
    collection: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional().default(10),
    embedding: z.array(z.number()).optional(),
    embedding_profile: z.string().optional(),
    media_base64: MediaBase64Schema,
    image_base64: MediaBase64Schema,
    data_type: z.string().optional()
});

const SearchRequestSchema = SearchFieldsSchema.refine((body) => body.query || body.embedding || body.media_base64 || body.image_base64, {
    message: 'query, embedding, media_base64, or image_base64 is required'
});

const EmbeddingUpsertSchema = z.object({
    id: z.string().optional(),
    content: z.string().min(1),
    embedding: z.array(z.number()).optional(),
    embedding_profile: z.string().optional(),
    media_base64: MediaBase64Schema,
    image_base64: MediaBase64Schema,
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
    embedding_profile: z.string().optional(),
    media_base64: MediaBase64Schema,
    image_base64: MediaBase64Schema,
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const IngestRequestSchema = z.object({
    content: z.string().min(1),
    source_type: z.enum(['file', 'url', 'text']),
    source_name: z.string(),
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable(),
    embedding_profile: z.string().optional(),
    metadata: z.record(z.unknown()).optional()
});

// GET /api/v1/embedding-profile - Active embedding profile and runtime probe.
router.get('/v1/embedding-profile', async (_req: Request, res: Response) => {
    const profile = embeddingService.profile();
    const runtime = await embeddingService.runtimeStatus();
    res.json({
        success: true,
        data: {
            profile: {
                id: profile.id,
                runtime: profile.runtime,
                modality: profile.modality,
                model: profile.model,
                dimensions: profile.dimensions,
                provider: profile.provider,
                baseUrl: profile.baseUrl,
                endpoint: profile.llamaCpp?.endpoint
            },
            runtime,
            capabilities: {
                textEmbeddings: embeddingService.isConfigured(profile.id),
                visionEmbeddings: profile.modality === 'multimodal' && runtime.modalities?.vision === true
            }
        }
    });
});

// POST /api/v1/search - Multi-scope vector search
router.post('/v1/search', async (req: Request, res: Response) => {
    try {
        const body = SearchRequestSchema.parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!ensureEmbeddingConfigured(res, body.embedding_profile)) return;
            embedding = await embeddingService.generateEmbedding(
                embeddingInput(body.query || '', body),
                getUsageContext(req),
                body.embedding_profile
            );
        }

        const results = await vectorStore.search(
            embedding,
            body.scopes as ScopeRef[],
            body.limit,
            body.data_type
        );

        res.json({
            success: true,
            data: results,
            query: body.query || ''
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
            if (!ensureEmbeddingConfigured(res, body.embedding_profile)) return;
            embedding = await embeddingService.generateEmbedding(
                embeddingInput(body.content, body),
                getUsageContext(req),
                body.embedding_profile
            );
        }

        const id = body.id || crypto.randomUUID();

        await vectorStore.upsertEmbedding({
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
        await vectorStore.deleteById(id as string);
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
            const profileId = singleProfile(chunksToEmbed);
            if (!ensureEmbeddingConfigured(res, profileId, 'Provide embeddings in request.')) return;
            embeddings = await embeddingService.generateEmbeddings(
                chunksToEmbed.map(c => embeddingInput(c.content, c)),
                getUsageContext(req),
                profileId
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

        await vectorStore.upsertDocumentChunks(processedChunks);

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
        await vectorStore.deleteDocumentChunks(documentId as string);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete chunks error:', error);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// POST /api/v1/documents/search - Search document chunks
router.post('/v1/documents/search', async (req: Request, res: Response) => {
    try {
        const body = SearchFieldsSchema.extend({
            document_id: z.string().optional()
        }).refine((value) => value.query || value.embedding || value.media_base64 || value.image_base64, {
            message: 'query, embedding, media_base64, or image_base64 is required'
        }).parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!ensureEmbeddingConfigured(res, body.embedding_profile)) return;
            embedding = await embeddingService.generateEmbedding(
                embeddingInput(body.query || '', body),
                getUsageContext(req),
                body.embedding_profile
            );
        }

        const results = await vectorStore.searchDocumentChunks(
            embedding,
            body.scopes as ScopeRef[],
            body.document_id,
            body.limit
        );

        res.json({
            success: true,
            data: results,
            query: body.query || ''
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

        if (!ensureEmbeddingConfigured(res, body.embedding_profile, 'Cannot ingest content.')) return;

        // Simple chunking: split by paragraphs or fixed size
        const chunks = chunkContent(body.content, 1000, 200);
        const embeddings = await embeddingService.generateEmbeddings(chunks, getUsageContext(req), body.embedding_profile);

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

        await vectorStore.upsertDocumentChunks(processedChunks);

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
                if (!ensureEmbeddingConfigured(res, item.embedding_profile, 'Provide embeddings in request.')) return;
                embedding = await embeddingService.generateEmbedding(
                    embeddingInput(item.content, item),
                    ctx,
                    item.embedding_profile
                );
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

        await vectorStore.upsertEmbeddings(processedItems);

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

        await vectorStore.deleteByScope(body.scope as Scope, body.scope_id);
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
            embedding_profile: z.string().optional(),
            media_base64: MediaBase64Schema,
            image_base64: MediaBase64Schema,
            scope: z.enum(['global', 'org', 'agent']),
            scope_id: z.string().nullable()
        }).parse(req.body);

        let embedding = body.embedding;
        if (!embedding) {
            if (!ensureEmbeddingConfigured(res, body.embedding_profile)) return;
            embedding = await embeddingService.generateEmbedding(
                embeddingInput(body.content, body),
                getUsageContext(req),
                body.embedding_profile
            );
        }

        const id = body.id || crypto.randomUUID();

        await vectorStore.upsertDocumentSummary({
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
            if (!ensureEmbeddingConfigured(res, body.embedding_profile)) return;
            embedding = await embeddingService.generateEmbedding(
                embeddingInput(body.query || '', body),
                getUsageContext(req),
                body.embedding_profile
            );
        }

        const results = await vectorStore.searchDocumentSummaries(
            embedding,
            body.scopes as ScopeRef[],
            body.limit
        );

        res.json({
            success: true,
            data: results,
            query: body.query || ''
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
        await vectorStore.deleteDocumentSummary(documentId as string);
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

        await vectorStore.deleteDocumentSummariesByScope(body.scope as Scope, body.scope_id);
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

        await vectorStore.deleteDocumentChunksByScope(body.scope as Scope, body.scope_id);
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
        const stats = await vectorStore.getStats();
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
