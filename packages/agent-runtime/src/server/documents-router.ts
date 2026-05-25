import { Router, type Request, type Response } from 'express';
import type { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import type {
  AgentTarget, AnyToolDefinition, ChatMessage, ChatStreamEvent, ToolContext,
} from '@teamsuzie/agent-loop';
import type { InMemoryFileStore } from './files-route.js';
import { exportDocFromMarkdown } from './document-tools.js';
import {
  createProgressiveArtifactHandler, parseNdjsonFromLlm,
} from './progressive-artifact.js';
import { runDocumentDiff } from './run-document-diff.js';

/**
 * Snapshot of the manifest's simpleModel target (baseUrl + apiKey +
 * model name). The /compare/summary endpoint uses this for topic
 * synthesis. Resolved per-request so manifest edits take effect without
 * a restart.
 */
export interface SummaryModelTarget {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Provider-specific knobs merged into every chat-completion request
   *  (e.g. {enable_thinking: false} for Qwen). Inherit from the host's
   *  main agent target so the summary call gets the same treatment as
   *  the chat — otherwise Qwen's thinking-on default makes synthesis
   *  take minutes. */
  extraBody?: Record<string, unknown>;
}

/**
 * Streaming chat-turn function — matches `runChatTurn` from
 * `@teamsuzie/agent-loop`. Passed in by the host so this router doesn't
 * have to own LLM transport. The summary endpoint only consumes `chunk`
 * events from the returned stream.
 */
export type StreamingRunChatTurn = (input: {
  agent: AgentTarget;
  messages: ChatMessage[];
  tools: AnyToolDefinition[];
  toolCtx: ToolContext;
  systemPrompt?: string;
  maxIterations?: number;
  signal?: AbortSignal;
}) => AsyncGenerator<ChatStreamEvent, void, unknown>;

export interface DocumentsRouterOptions {
  fileStore: InMemoryFileStore;
  docStore: InMemoryDocumentStore;
  /**
   * markitdown-agent base URL. When empty, the export endpoint returns
   * 503; the panel uses that signal to fall back to "not yet exported".
   */
  markitdownBaseUrl: string;
  /**
   * Resolver for the simpleModel target — runs every request so
   * manifest edits take effect immediately. Return null when no model
   * is configured; the /compare/summary endpoint then 503s and the
   * client falls back to its mechanical view.
   */
  resolveSummaryModel?: () => SummaryModelTarget | null;
  /** Injected for testability. In prod, this is `runChatTurn` from `@teamsuzie/agent-loop`. */
  runChatTurn?: StreamingRunChatTurn;
  /** ToolContext passed to runChatTurn. Reused from the host so
   *  approvals/etc. share state with the chat path. */
  toolCtx?: ToolContext;
  fetchImpl?: typeof fetch;
}

/**
 * Documents endpoints — user-driven counterparts to the model-driven
 * drafting tools. Mounted unconditionally; absent prerequisites surface
 * as 503/404 rather than missing routes.
 *
 *   POST /api/documents/:sessionId/:docId/export
 *     Body: { filename? }
 *     503 when markitdown-agent isn't configured.
 *     404 when the doc isn't in the session's docStore.
 *     200 → { fileId, filename, downloadUrl }.
 *
 *   POST /api/documents/compare/summary
 *     Body: { leftFileId, rightFileId, sessionId }
 *     503 when no simpleModel is configured.
 *     404 when either file id isn't in the session's fileStore.
 *     200 → SSE stream. Each `data:` event is either:
 *       {"topic":"…","left":"…","right":"…"}   one synthesized topic
 *       {"done":true}                          terminal signal
 *       {"error":"…"}                          terminal failure
 *     LLM is prompted to emit NDJSON (one topic-JSON per line) so the
 *     server can parse + forward each completed line as soon as it
 *     arrives. CompareTable appends to the table as topics stream in.
 */
export function createDocumentsRouter(opts: DocumentsRouterOptions): Router {
  const router: Router = Router();
  const {
    fileStore, docStore, markitdownBaseUrl, fetchImpl,
    resolveSummaryModel, runChatTurn, toolCtx,
  } = opts;

  router.post('/:sessionId/:docId/export', async (req: Request, res: Response) => {
    if (!markitdownBaseUrl) {
      res.status(503).json({ error: 'markitdown-agent is not configured' });
      return;
    }
    const sessionId = String(req.params.sessionId ?? '');
    const docId = String(req.params.docId ?? '');
    const doc = docStore.get(sessionId, docId);
    if (!doc) {
      res.status(404).json({ error: 'document not found' });
      return;
    }
    const body = (req.body ?? {}) as { filename?: string };
    const requested = (body.filename ?? doc.title ?? 'document').toString();
    const stem = requested.replace(/[^\w.-]+/g, '_').replace(/\.docx$/i, '') || 'document';

    try {
      const result = await exportDocFromMarkdown({
        sessionId,
        markdown: doc.getMarkdown(),
        filename: stem,
        markitdownBaseUrl,
        fileStore,
        fetchImpl,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'export failed',
      });
    }
  });

  // Pre-flight checks live in a tiny middleware so the helper sees a
  // valid model + body. 503 here is a hard "endpoint not wired"
  // signal; 400/404 inside parseBody surface as the helper's standard
  // 400 frame.
  if (resolveSummaryModel && runChatTurn) {
    const run = runChatTurn;
    router.post(
      '/compare/summary',
      createProgressiveArtifactHandler<
        { sessionId: string; leftFileId: string; rightFileId: string },
        { topic: string; left: string; right: string }
      >({
        parseBody(raw) {
          const b = (raw ?? {}) as {
            sessionId?: string; leftFileId?: string; rightFileId?: string;
          };
          const sessionId = String(b.sessionId ?? '').trim();
          const leftFileId = String(b.leftFileId ?? '').trim();
          const rightFileId = String(b.rightFileId ?? '').trim();
          if (!sessionId || !leftFileId || !rightFileId) {
            throw new Error(
              'sessionId, leftFileId, and rightFileId are required',
            );
          }
          if (leftFileId === rightFileId) {
            throw new Error('left and right must reference different files');
          }
          // Reject missing files at validation time so the client gets
          // a 404 instead of a 200 + error frame. Validation throws
          // surface via the helper's 400 path; we override that with a
          // synthetic 404 below for "not found" specifically.
          const left = fileStore.get(sessionId, leftFileId);
          const right = fileStore.get(sessionId, rightFileId);
          if (!left || !right) {
            const e = new Error('left or right file not found in session');
            (e as Error & { httpStatus?: number }).httpStatus = 404;
            throw e;
          }
          return { sessionId, leftFileId, rightFileId };
        },
        async *run(body, signal) {
          const model = resolveSummaryModel();
          if (!model) {
            throw new Error('no simpleModel configured for synthesis');
          }
          // Re-fetch the records (parseBody already verified existence).
          const left = fileStore.get(body.sessionId, body.leftFileId)!;
          const right = fileStore.get(body.sessionId, body.rightFileId)!;

          const diff = await runDocumentDiff(left, right, { markitdownBaseUrl, fetchImpl });
          const diffMarkdown = renderDiffMarkdownCompact(diff);

          const systemPrompt =
            'You are summarizing the substantive differences between two versions of a legal document. '
            + 'You receive a mechanical paragraph-level diff with `~~deletions~~` and `**insertions**` inline. '
            + 'GROUP the changes by substantive TOPIC (e.g. "Excused Investments", "Notice Provisions", "Anti-Money Laundering"). '
            + 'For each topic write a short plain-English summary of what the LEFT document says and what the RIGHT document says. '
            + 'When a topic exists on only one side, the other side\'s field should be "(absent)". '
            + 'Skip purely cosmetic differences (whitespace, formatting). '
            + '\n\n'
            + 'OUTPUT FORMAT: NDJSON. Emit ONE complete JSON object per line, NO comma, NO surrounding array, NO code fence, NO prose. '
            + 'Each line: {"topic":"…","left":"…","right":"…"}. '
            + 'Emit topics as you identify them — do not wait until you have them all.';
          const userPrompt =
            `LEFT document: ${left.name}\nRIGHT document: ${right.name}\n\n`
            + `Mechanical diff:\n\n${diffMarkdown}`;

          const safeToolCtx: ToolContext = toolCtx ?? {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            approvals: {} as any,
            vectorDbBaseUrl: '',
          };
          const llmStream = run({
            agent: model,
            messages: [{ role: 'user', content: userPrompt }],
            systemPrompt,
            tools: [],
            toolCtx: safeToolCtx,
            maxIterations: 1,
            signal,
          });

          for await (const obj of parseNdjsonFromLlm<{
            topic: string; left: string; right: string;
          }>({
            llmStream,
            parseLine(line) {
              const parsed = JSON.parse(line) as {
                topic?: unknown; left?: unknown; right?: unknown;
              };
              const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : '';
              const leftSide = typeof parsed.left === 'string' ? parsed.left.trim() : '';
              const rightSide = typeof parsed.right === 'string' ? parsed.right.trim() : '';
              if (!topic) return null;
              return { topic, left: leftSide, right: rightSide };
            },
          })) {
            yield obj;
          }
        },
      }),
    );
  } else {
    // Helper isn't wired (host didn't pass the model resolver /
    // runChatTurn). Hard 503 so the client knows synthesis isn't
    // available at all.
    router.post('/compare/summary', (_req: Request, res: Response) => {
      res.status(503).json({ error: 'compare summary endpoint not configured' });
    });
  }

  return router;
}

/**
 * Compact-ish version of the per-paragraph markdown report used as the
 * LLM's source. Equivalent shape to compare-documents-tool's
 * renderDiffMarkdown — duplicated locally to avoid a circular import.
 */
function renderDiffMarkdownCompact(diff: {
  left: { name: string };
  right: { name: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: any[];
}): string {
  const lines: string[] = [];
  for (const event of diff.events) {
    if (event.kind === 'unchanged') continue;
    if (event.kind === 'modified') {
      const inline = (event.ops as Array<{ kind: string; text: string }>)
        .map((op) => {
          const t = op.text.trim();
          if (!t) return op.text;
          if (op.kind === 'equal') return op.text;
          const marker = op.kind === 'delete' ? '~~' : '**';
          return `${marker}${t}${marker}`;
        })
        .join('');
      lines.push(`¶${event.leftIndex + 1}→¶${event.rightIndex + 1} (modified): ${inline}`);
    } else if (event.kind === 'deleted') {
      lines.push(`¶${event.leftIndex + 1} (deleted from left): ${event.text}`);
    } else {
      lines.push(`¶${event.rightIndex + 1} (inserted into right): ${event.text}`);
    }
  }
  return lines.join('\n');
}
