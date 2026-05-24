import express, { type Router } from 'express';
import type { RegistrationMeta, AiDraftKindHandler } from '../extensions/types.js';

/**
 * AI-fill router. Drafts text for a known "kind" using a manifest-configured
 * simple model. Kinds are kept on the server so the system prompt for each
 * field stays consistent across UI surfaces (LibraryPage prompt form,
 * PersonasPage system prompt, etc).
 *
 * Mounted UNCONDITIONALLY by server/index.ts. When manifest.ai.simpleModel is
 * undefined the endpoint returns 503; client-side AI-fill buttons should hide
 * themselves in that case via /api/health (or a future capabilities probe).
 *
 * Kinds are tracked in an AiDraftKindRegistry so extensions (Task 3.5.6) can
 * register their own via the same API as core kinds.
 */

export class AiDraftKindRegistry {
  private kinds = new Map<string, { handler: AiDraftKindHandler; meta: RegistrationMeta }>();

  register(kind: string, handler: AiDraftKindHandler, meta: RegistrationMeta = { source: 'core' }): void {
    this.kinds.set(kind, { handler, meta });
  }

  get(kind: string): AiDraftKindHandler | undefined {
    return this.kinds.get(kind)?.handler;
  }

  metaFor(kind: string): RegistrationMeta | undefined {
    return this.kinds.get(kind)?.meta;
  }

  list(): string[] {
    return Array.from(this.kinds.keys());
  }
}

export function createCoreAiDraftKinds(): AiDraftKindRegistry {
  const r = new AiDraftKindRegistry();
  r.register('prompt-body', { systemPromptFor: (c: any) =>
    `You draft a useful prompt body. The user has provided a title and optional description. ` +
    `Return only the prompt body — no preamble, no quotes, no "Here is...". Keep it 2–4 sentences. ` +
    `Title: "${c.title ?? ''}". Description: "${c.description ?? ''}".`,
  });
  r.register('persona-system', { systemPromptFor: (c: any) =>
    `You draft a persona system prompt. Given the persona's name and description, ` +
    `produce a tight system prompt (1–3 paragraphs) suitable for an LLM assistant in this domain. ` +
    `Name: "${c.name ?? ''}". Description: "${c.description ?? ''}".`,
  });
  r.register('workflow-prompt', { systemPromptFor: (c: any) =>
    `You draft a workflow prompt for a recurring task. Given a title and description, ` +
    `produce the prompt the user would paste into an assistant to perform the task. ` +
    `Title: "${c.title ?? ''}". Description: "${c.description ?? ''}".`,
  });
  r.register('review-column-prompt', { systemPromptFor: (c: any) =>
    `You draft a column prompt for a tabular document review. Given the column title, ` +
    `produce a concise prompt that, applied per row, yields a value of the desired format. ` +
    `Title: "${c.title ?? ''}".`,
  });
  return r;
}

export interface AiDraftDeps {
  simpleModel?: { baseUrl: string; apiKey?: string; model: string };
  kinds: AiDraftKindRegistry;
  runTurn: (input: {
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    model: string;
    baseUrl: string;
    apiKey?: string;
  }) => Promise<{ text: string }>;
}

export function createAiDraftRouter(deps: AiDraftDeps): Router {
  const router = express.Router();
  router.post('/', async (req, res) => {
    const { kind, context } = req.body ?? {};
    const handler = deps.kinds.get(kind);
    if (!handler) {
      res.status(400).json({ ok: false, error: `unknown kind: ${kind}` });
      return;
    }
    if (!deps.simpleModel) {
      res.status(503).json({ ok: false, error: 'no model configured (manifest.ai.simpleModel)' });
      return;
    }
    try {
      const { text } = await deps.runTurn({
        messages: [
          { role: 'system', content: handler.systemPromptFor(context ?? {}) },
          { role: 'user',   content: JSON.stringify(context ?? {}) },
        ],
        model: deps.simpleModel.model,
        baseUrl: deps.simpleModel.baseUrl,
        apiKey: deps.simpleModel.apiKey,
      });
      res.json({ ok: true, text });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });
  return router;
}
