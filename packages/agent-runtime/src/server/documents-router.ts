import { Router, type Request, type Response } from 'express';
import type { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import type {
  AgentTarget, AnyToolDefinition, ChatMessage, ChatStreamEvent, ToolContext,
} from '@teamsuzie/agent-loop';
import type { InMemoryFileStore } from './files-route.js';
import { exportDocFromMarkdown } from './document-tools.js';
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

  router.post('/compare/summary', async (req: Request, res: Response) => {
    if (!resolveSummaryModel || !runChatTurn) {
      res.status(503).json({ error: 'compare summary endpoint not configured' });
      return;
    }
    const model = resolveSummaryModel();
    if (!model) {
      res.status(503).json({ error: 'no simpleModel configured for synthesis' });
      return;
    }
    const body = (req.body ?? {}) as {
      leftFileId?: string;
      rightFileId?: string;
      sessionId?: string;
    };
    const sessionId = String(body.sessionId ?? '').trim();
    const leftFileId = String(body.leftFileId ?? '').trim();
    const rightFileId = String(body.rightFileId ?? '').trim();
    if (!sessionId || !leftFileId || !rightFileId) {
      res.status(400).json({
        error: 'sessionId, leftFileId, and rightFileId are required',
      });
      return;
    }
    const left = fileStore.get(sessionId, leftFileId);
    const right = fileStore.get(sessionId, rightFileId);
    if (!left || !right) {
      res.status(404).json({ error: 'left or right file not found in session' });
      return;
    }
    if (left.id === right.id) {
      res.status(400).json({ error: 'left and right must reference different files' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (payload: object) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    try {
      const diff = await runDocumentDiff(left, right, { markitdownBaseUrl, fetchImpl });
      const diffMarkdown = renderDiffMarkdownCompact(diff);

      // NDJSON prompt: model emits ONE complete JSON object per line.
      // We buffer chunks until we see a newline, then parse + forward.
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

      let buffer = '';
      let emitted = 0;
      const flushLines = () => {
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
          if (!line) continue;
          const cleaned = line.replace(/^```(?:json|ndjson)?\s*|\s*```$/g, '').trim();
          if (!cleaned || cleaned === '[' || cleaned === ']' || cleaned === ',') continue;
          // Strip a trailing comma if the model sneaks one in.
          const withoutComma = cleaned.endsWith(',')
            ? cleaned.slice(0, -1)
            : cleaned;
          try {
            const parsed = JSON.parse(withoutComma) as {
              topic?: unknown; left?: unknown; right?: unknown;
            };
            const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : '';
            const leftSide = typeof parsed.left === 'string' ? parsed.left.trim() : '';
            const rightSide = typeof parsed.right === 'string' ? parsed.right.trim() : '';
            if (topic) {
              emitted++;
              send({ topic, left: leftSide, right: rightSide });
            }
          } catch {
            // Skip malformed lines silently — model occasionally emits
            // commentary; we keep the stream alive.
          }
        }
      };

      // toolCtx is required by runChatTurn's signature but the summary
      // turn passes no tools, so the value is never consulted in
      // practice. Default to a minimal stub when host didn't provide one.
      const safeToolCtx: ToolContext = toolCtx ?? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        approvals: {} as any,
        vectorDbBaseUrl: '',
      };
      const stream = runChatTurn({
        agent: model,
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt,
        tools: [],
        toolCtx: safeToolCtx,
        maxIterations: 1,
        signal: abort.signal,
      });

      for await (const event of stream) {
        if (event.type === 'chunk') {
          buffer += event.text;
          flushLines();
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
      // Flush any trailing line that lacked a final newline.
      if (buffer.trim().length > 0) {
        buffer += '\n';
        flushLines();
      }
      send({ done: true, total: emitted });
    } catch (err) {
      send({
        error: err instanceof Error ? err.message : 'compare summary failed',
      });
    } finally {
      res.end();
    }
  });

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
