import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import { resolveModel, getProviderKey, PROVIDERS } from '../config.js';
import { publishUsage } from '../services/usage.js';
import { authMiddleware } from '../middleware/auth.js';

const router: IRouter = Router();

router.post('/v1/embeddings', authMiddleware, async (req: Request, res: Response) => {
    try {
        const body = req.body;
        const modelStr: string = body.model;

        if (!modelStr) {
            res.status(400).json({ error: 'Missing "model" field' });
            return;
        }

        const resolved = resolveModel(modelStr);
        if (!resolved) {
            res.status(400).json({ error: `Cannot resolve provider for model: ${modelStr}` });
            return;
        }

        const { provider, model } = resolved;
        const providerConfig = PROVIDERS[provider];
        const apiKey = getProviderKey(provider, req.keyHash);

        if (!apiKey) {
            res.status(502).json({ error: `No API key configured for provider: ${provider}` });
            return;
        }

        // Rewrite model name in the body (strip provider prefix)
        body.model = model;

        const upstreamUrl = `${providerConfig.apiBase}/embeddings`;

        const upstreamRes = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        const contentType = upstreamRes.headers.get('content-type') || 'application/json';
        res.status(upstreamRes.status);
        res.setHeader('Content-Type', contentType);

        const responseBody = await upstreamRes.text();

        // Extract usage for tracking
        try {
            const parsed = JSON.parse(responseBody);
            const usage = parsed?.usage;
            if (usage) {
                const totalTokens = usage.total_tokens ?? usage.prompt_tokens ?? 0;
                console.log(`[LLM-PROXY] Embeddings: ${provider}/${model} tokens=${totalTokens}`);

                publishUsage({
                    service: provider,
                    operation: 'embedding',
                    model,
                    input_units: totalTokens,
                    output_units: 0,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        request_id: parsed.id || undefined,
                        user_api_key_hash: req.keyHash || '',
                    },
                }).catch((err) => {
                    console.error('[LLM-PROXY] Failed to emit embedding usage:', err.message);
                });
            }
        } catch {
            // Not JSON — just forward
        }

        res.send(responseBody);
    } catch (err: any) {
        console.error('[LLM-PROXY] Embeddings error:', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Upstream request failed', message: err.message });
        }
    }
});

export default router;
