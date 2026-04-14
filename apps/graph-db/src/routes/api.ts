import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import Neo4jService, { EntityType } from '../services/neo4j.js';
import type { Scope, ScopeRef } from '@teamsuzie/types';

const router: express.Router = Router();
const neo4jService = new Neo4jService();

// Initialize Neo4j connection
neo4jService.connect().catch(err => {
    console.error('[API] Failed to connect to Neo4j:', err);
});

// Validation schemas
const ScopeRefSchema = z.object({
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const EntityTypeSchema = z.enum(['person', 'org', 'project', 'task', 'doc', 'role', 'trait', 'topic', 'location', 'product']);

const CreateEntitySchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    type: EntityTypeSchema,
    properties: z.record(z.unknown()).optional(),
    scope: z.enum(['global', 'org', 'agent']),
    scope_id: z.string().nullable()
});

const RelationshipSchema = z.object({
    from_id: z.string(),
    to_id: z.string(),
    type: z.string().min(1),
    properties: z.record(z.unknown()).optional()
});

const SearchSchema = z.object({
    q: z.string().min(1),
    scopes: z.array(ScopeRefSchema).min(1),
    type: EntityTypeSchema.optional(),
    limit: z.number().int().min(1).max(100).optional().default(10)
});

const CypherQuerySchema = z.object({
    query: z.string().min(1),
    params: z.record(z.unknown()).optional(),
    scopes: z.array(ScopeRefSchema).optional()
});

// POST /api/v1/entities - Create or update entity
router.post('/v1/entities', async (req: Request, res: Response) => {
    try {
        const body = CreateEntitySchema.parse(req.body);

        // Check for admin role if scope is global
        if (body.scope === 'global') {
            console.warn('[API] Global scope entity creation - ensure admin authorization');
        }

        const id = await neo4jService.createOrUpdateEntity({
            id: body.id,
            name: body.name,
            type: body.type as EntityType,
            properties: body.properties,
            scope: body.scope as Scope,
            scope_id: body.scope_id
        });

        res.status(201).json({
            success: true,
            data: { id, name: body.name, type: body.type }
        });
    } catch (error) {
        console.error('[API] Create entity error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Entity creation failed' });
    }
});

// GET /api/v1/entities/:id - Get entity by ID
router.get('/v1/entities/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const scopesParam = req.query.scopes as string | undefined;

        let scopes: ScopeRef[] | undefined;
        if (scopesParam) {
            scopes = JSON.parse(scopesParam);
        }

        const entity = await neo4jService.getEntity(id as string, scopes);

        if (!entity) {
            res.status(404).json({ success: false, error: 'Entity not found' });
            return;
        }

        res.json({ success: true, data: entity });
    } catch (error) {
        console.error('[API] Get entity error:', error);
        res.status(500).json({ success: false, error: 'Failed to get entity' });
    }
});

// DELETE /api/v1/entities/:id - Delete entity
router.delete('/v1/entities/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await neo4jService.deleteEntity(id as string);
        res.json({ success: true });
    } catch (error) {
        console.error('[API] Delete entity error:', error);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// POST /api/v1/entities/search - Search entities
router.post('/v1/entities/search', async (req: Request, res: Response) => {
    try {
        const body = SearchSchema.parse(req.body);

        const results = await neo4jService.searchEntities(
            body.q,
            body.scopes as ScopeRef[],
            body.type as EntityType | undefined,
            body.limit
        );

        res.json({
            success: true,
            data: results,
            query: body.q
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

// GET /api/v1/entities/search - Search entities (GET version)
router.get('/v1/entities/search', async (req: Request, res: Response) => {
    try {
        const q = req.query.q as string;
        const scopesParam = req.query.scopes as string;
        const type = req.query.type as string | undefined;
        const limit = parseInt(req.query.limit as string || '10', 10);

        if (!q || !scopesParam) {
            res.status(400).json({ success: false, error: 'q and scopes are required' });
            return;
        }

        const scopes = JSON.parse(scopesParam) as ScopeRef[];

        const results = await neo4jService.searchEntities(
            q,
            scopes,
            type as EntityType | undefined,
            limit
        );

        res.json({
            success: true,
            data: results,
            query: q
        });
    } catch (error) {
        console.error('[API] Search error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// POST /api/v1/entities/batch - Batch create/update entities
router.post('/v1/entities/batch', async (req: Request, res: Response) => {
    try {
        const entities = z.array(CreateEntitySchema).parse(req.body.entities);

        const ids = await neo4jService.createEntitiesBatch(
            entities.map(e => ({
                id: e.id,
                name: e.name,
                type: e.type as EntityType,
                properties: e.properties,
                scope: e.scope as Scope,
                scope_id: e.scope_id
            }))
        );

        res.status(201).json({
            success: true,
            data: { ids, count: ids.length }
        });
    } catch (error) {
        console.error('[API] Batch create entities error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Batch entity creation failed' });
    }
});

// POST /api/v1/relationships - Create relationship
router.post('/v1/relationships', async (req: Request, res: Response) => {
    try {
        const body = RelationshipSchema.parse(req.body);

        await neo4jService.createRelationship({
            from_id: body.from_id,
            to_id: body.to_id,
            type: body.type.toUpperCase().replace(/\s+/g, '_'),
            properties: body.properties
        });

        res.status(201).json({
            success: true,
            data: { from_id: body.from_id, to_id: body.to_id, type: body.type }
        });
    } catch (error) {
        console.error('[API] Create relationship error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Relationship creation failed' });
    }
});

// POST /api/v1/query/cypher - Execute read-only Cypher query
router.post('/v1/query/cypher', async (req: Request, res: Response) => {
    try {
        const body = CypherQuerySchema.parse(req.body);

        // Security: Only allow read operations
        const query = body.query.trim().toUpperCase();
        if (!query.startsWith('MATCH') && !query.startsWith('RETURN') && !query.startsWith('CALL')) {
            res.status(400).json({
                success: false,
                error: 'Only read operations (MATCH, RETURN, CALL) are allowed'
            });
            return;
        }

        const results = await neo4jService.runQuery(body.query, body.params);

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('[API] Cypher query error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Query failed' });
    }
});

// POST /api/v1/relationships/batch - Batch create relationships
router.post('/v1/relationships/batch', async (req: Request, res: Response) => {
    try {
        const rels = z.array(RelationshipSchema).parse(req.body.relationships);

        const processedRels = rels.map(r => ({
            from_id: r.from_id,
            to_id: r.to_id,
            type: r.type.toUpperCase().replace(/\s+/g, '_'),
            properties: r.properties
        }));

        await neo4jService.createRelationshipsBatch(processedRels);

        res.status(201).json({
            success: true,
            data: { count: processedRels.length }
        });
    } catch (error) {
        console.error('[API] Batch create relationships error:', error);
        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: 'Invalid request', details: error.errors });
            return;
        }
        res.status(500).json({ success: false, error: 'Batch relationship creation failed' });
    }
});

// GET /api/v1/relationships - Get relationships by scope
router.get('/v1/relationships', async (req: Request, res: Response) => {
    try {
        const scopesParam = req.query.scopes as string;
        const limit = parseInt(req.query.limit as string || '100', 10);

        if (!scopesParam) {
            res.status(400).json({ success: false, error: 'scopes parameter is required' });
            return;
        }

        const scopes = JSON.parse(scopesParam) as ScopeRef[];
        const results = await neo4jService.getRelationships(scopes, limit);

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('[API] Get relationships error:', error);
        res.status(500).json({ success: false, error: 'Failed to get relationships' });
    }
});

// DELETE /api/v1/entities/by-scope - Delete entities by scope
router.delete('/v1/entities/by-scope', async (req: Request, res: Response) => {
    try {
        const body = z.object({
            scope: z.enum(['global', 'org', 'agent']),
            scope_id: z.string().nullable()
        }).parse(req.body);

        await neo4jService.deleteByScope(body.scope as Scope, body.scope_id);
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

// GET /api/v1/stats - Node and relationship counts
router.get('/v1/stats', async (_req: Request, res: Response) => {
    try {
        const stats = await neo4jService.getStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('[API] Stats error:', error);
        res.status(500).json({ success: false, error: 'Stats failed' });
    }
});

export default router;
