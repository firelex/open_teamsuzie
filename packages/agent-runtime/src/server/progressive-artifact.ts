import type { RequestHandler } from 'express';
import type { ChatStreamEvent } from '@teamsuzie/agent-loop';

/**
 * Progressive-artifact pattern. A tool returns a small, fast result
 * including a URL the client can subscribe to for progressive content
 * (LLM-streamed topics, extracted entities, scored clauses, etc.).
 * The endpoint at that URL is an SSE stream where each `data:` event
 * is one chunk. The client appends chunks to a UI artifact (e.g.
 * `<CompareTable>`) as they arrive.
 *
 * This file factors the server-side plumbing out of the original
 * compare_documents wiring so subsequent tools can opt into the same
 * pattern with ~10 lines each. Two pieces:
 *
 *   1. {@link createProgressiveArtifactHandler} — an Express
 *      RequestHandler that runs the caller's async iterable to
 *      completion, SSE-encoding each yielded chunk. Handles
 *      `{done:true}` framing, abort on socket close, `{error:"…"}` on
 *      throw.
 *
 *   2. {@link parseNdjsonFromLlm} — an async-iterable transform from
 *      an LLM chunk stream (typically `runChatTurn`'s output) to one
 *      parsed object per NDJSON line. Tolerates code fences, leading
 *      commentary lines, trailing commas, and `[`/`]` array brackets
 *      so the prompt can be a soft "emit NDJSON" rather than enforced
 *      grammar.
 *
 * Compare these conventions to the chat-route's SSE shape: very
 * similar (one frame per logical event), but progressive-artifact
 * frames carry one of three shapes:
 *
 *   {<chunk fields>}        — one synthesized item
 *   {"done": true, "total": N}   — terminal success
 *   {"error": "…"}          — terminal failure
 */

export interface ProgressiveArtifactHandlerOptions<TBody, TChunk> {
  /**
   * Validate + parse the request body. Throw to surface a 400 with
   * the error's message; return the typed body for the run callback.
   */
  parseBody(raw: unknown): TBody;
  /**
   * Run the artifact. Yields one chunk per item the client should
   * append. The helper SSE-encodes each chunk as `data: {…}\n\n` and
   * emits a terminal `{done:true,total}` frame on completion.
   *
   * `signal` is aborted when the client disconnects — pass it through
   * to fetch / runChatTurn so the upstream work stops too.
   */
  run(body: TBody, signal: AbortSignal): AsyncIterable<TChunk>;
}

export function createProgressiveArtifactHandler<TBody, TChunk>(
  opts: ProgressiveArtifactHandlerOptions<TBody, TChunk>,
): RequestHandler {
  return async (req, res) => {
    let body: TBody;
    try {
      body = opts.parseBody(req.body ?? {});
    } catch (err) {
      // Default to 400; parseBody can override by setting `httpStatus`
      // on the thrown Error (e.g. 404 for "not found" cases).
      const status = err instanceof Error
        && typeof (err as Error & { httpStatus?: unknown }).httpStatus === 'number'
        ? (err as Error & { httpStatus: number }).httpStatus
        : 400;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'invalid body',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });

    const send = (frame: unknown) =>
      res.write(`data: ${JSON.stringify(frame)}\n\n`);

    let total = 0;
    try {
      for await (const chunk of opts.run(body, ac.signal)) {
        send(chunk);
        total++;
      }
      send({ done: true, total });
    } catch (err) {
      send({
        error: err instanceof Error ? err.message : 'progressive artifact failed',
      });
    } finally {
      res.end();
    }
  };
}

export interface ParseNdjsonFromLlmOptions<TChunk> {
  /**
   * Source LLM stream — typically `runChatTurn(...)` output. The
   * helper only reads `chunk` events (text accumulated into a line
   * buffer) and `error` events (re-thrown).
   */
  llmStream: AsyncIterable<ChatStreamEvent>;
  /**
   * Parse one already-cleaned NDJSON line into a typed chunk. Return
   * null to skip the line (e.g. it parsed but the shape's wrong).
   * Synchronous throw is fine — the line is skipped.
   */
  parseLine(line: string): TChunk | null;
}

/**
 * Transform an LLM chunk stream into one parsed chunk per complete
 * NDJSON line. Tolerant of:
 *   - leading/trailing code fences (```json … ```)
 *   - array-wrapper lines (`[`, `]`)
 *   - trailing commas on object lines (some models sneak them in)
 *   - non-JSON commentary lines (silently skipped)
 *   - prompts where the model emits one giant line instead of NDJSON
 *     (the trailing buffer is flushed on stream end as a single line)
 */
export async function* parseNdjsonFromLlm<TChunk>(
  opts: ParseNdjsonFromLlmOptions<TChunk>,
): AsyncIterable<TChunk> {
  let buffer = '';

  const tryParse = (rawLine: string): TChunk | null => {
    const cleaned = rawLine
      .replace(/^```(?:json|ndjson)?\s*|\s*```$/g, '')
      .trim();
    if (!cleaned || cleaned === '[' || cleaned === ']' || cleaned === ',') {
      return null;
    }
    const withoutComma = cleaned.endsWith(',')
      ? cleaned.slice(0, -1)
      : cleaned;
    try {
      return opts.parseLine(withoutComma);
    } catch {
      return null;
    }
  };

  function* flushCompleteLines(): Generator<TChunk> {
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
      if (!line) continue;
      const parsed = tryParse(line);
      if (parsed !== null) yield parsed;
    }
  }

  for await (const event of opts.llmStream) {
    if (event.type === 'chunk') {
      buffer += event.text;
      yield* flushCompleteLines();
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }
  // Flush any trailing line that lacked a final newline.
  if (buffer.trim().length > 0) {
    const parsed = tryParse(buffer.trim());
    if (parsed !== null) yield parsed;
  }
}
