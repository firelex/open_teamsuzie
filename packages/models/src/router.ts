import { Router, type Request, type Response } from 'express';

import { ModelGateway } from './gateway.js';
import type { ChatMessage } from './types.js';

/**
 * A router mountable with `app.use(path, modelsRouter(gateway))` on ANY express
 * major version. Typed as a plain middleware callable so the package doesn't leak
 * a version-specific express `Router` type across its boundary — apps here use a
 * mix of express 4 and 5. It is a real express Router at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MountableRouter = (req: any, res: any, next: any) => void;

/**
 * Express router for the Models feature. Mount at `/api/models`:
 *   GET  /api/models        → { configured, setup, models: ModelInfo[] }
 *   POST /api/models/chat    → Server-Sent Events: {text} deltas, then {done:true}
 *
 * Errors (bad model, missing key, provider failure) are streamed as a visible
 * {error} event so the UI shows the reason in-viewport rather than failing silently.
 */
export function modelsRouter(gateway: ModelGateway): MountableRouter {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      res.json({
        configured: gateway.isConfigured(),
        setup: gateway.describeSetup(),
        models: await gateway.listModels(),
      });
    } catch (err) {
      res.status(500).json({ error: message(err) });
    }
  });

  router.post('/chat', async (req: Request, res: Response) => {
    const body = req.body as { id?: unknown; messages?: unknown; maxTokens?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    const messages = normalizeMessages(body.messages);
    if (!id || messages.length === 0) {
      res.status(400).json({ error: 'A model `id` and non-empty `messages` are required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Abort the provider request only if the CLIENT disconnects mid-stream —
    // detected by the response closing before we've finished writing. (`req`'s
    // close event also fires on normal completion, so it can't be used here.)
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      for await (const text of gateway.stream({
        id,
        messages,
        maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
        signal: controller.signal,
      })) {
        send({ text });
      }
      send({ done: true });
    } catch (err) {
      // Surface the failure/refusal as a visible event, unless the client is gone.
      if (!res.writableEnded && !res.destroyed) send({ error: message(err) });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  return router as unknown as MountableRouter;
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const roles = new Set(['system', 'user', 'assistant']);
  return value
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof (m as ChatMessage).content === 'string' &&
        roles.has((m as ChatMessage).role),
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
