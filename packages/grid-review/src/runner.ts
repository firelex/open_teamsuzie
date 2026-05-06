import {
    parseResponse,
    type Citation,
    type CitationWarning,
    type PreparedDocument,
} from '@teamsuzie/citations';

import { coerceCellOutput, retryPromptFor, type CoerceResult } from './coerce.js';
import { buildCellMessages, type CellChatMessage } from './prompt.js';
import type { CellFormat, ReviewColumn } from './types.js';

export type LlmStream = (args: {
    messages: CellChatMessage[];
    signal?: AbortSignal;
}) => AsyncIterable<string>;

export type CellEvent =
    | { type: 'token'; text: string }
    | {
          /**
           * Adapters may emit a one-shot 'retrieved' event before the model
           * starts streaming — surfaces what context was assembled (e.g.
           * "Retrieved 3 passages from Side Letter.docx"). The router
           * relays it via SSE; cell persistence is not affected.
           */
          type: 'retrieved';
          summary: string;
          chunkCount?: number;
          /** Verbatim chunk content in retrieval (relevance) order. Optional. */
          chunks?: Array<{ content: string; distance?: number }>;
          /**
           * The retrieval query actually sent to the embedder, when it
           * differs from the column's prompt — e.g. a HyDE hypothetical
           * answer. Surfaced in the modal for debugging.
           */
          retrievalQuery?: string;
      }
    | {
          type: 'done';
          text: string;
          citations: Citation[];
          warnings: CitationWarning[];
      }
    | { type: 'error'; error: Error };

export interface RunCellOptions {
    document: PreparedDocument;
    documentLabel?: string;
    /** The column being filled. */
    column: Pick<ReviewColumn, 'prompt'>;
    llm: LlmStream;
    signal?: AbortSignal;
}

/**
 * Run one cell of a tabular review. Streams `token` events as the model
 * generates text, then yields exactly one `done` event with the citation
 * block parsed out of the accumulated reply (HTML-comment block stripped
 * from `text`; markers preserved). On LLM failure yields one `error` event
 * and returns — never throws.
 *
 * The runner is provider-agnostic: pass any `LlmStream` callback. Storage
 * is the caller's job — pipe `done.text` / `done.citations` into
 * `ReviewsStore.upsertCell` (or wherever) yourself.
 */
export async function* runCell(opts: RunCellOptions): AsyncIterable<CellEvent> {
    const messages = buildCellMessages({
        document: opts.document,
        documentLabel: opts.documentLabel,
        prompt: opts.column.prompt,
        format: 'text',
    });

    let accumulated = '';
    try {
        for await (const chunk of opts.llm({ messages, signal: opts.signal })) {
            if (typeof chunk !== 'string' || chunk.length === 0) continue;
            accumulated += chunk;
            yield { type: 'token', text: chunk };
        }
    } catch (err) {
        yield {
            type: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
        };
        return;
    }

    const { text, citations, warnings } = parseResponse(accumulated, {
        knownDocs: [opts.document.handle],
    });
    yield { type: 'done', text, citations, warnings };
}

export type FormattedCellEvent =
    | { type: 'token'; text: string }
    | { type: 'retry'; reason: string; format: CellFormat }
    | {
          type: 'done';
          text: string;
          /** Canonical coerced value, or null if both passes failed. */
          formatted: string | null;
          citations: Citation[];
          warnings: CitationWarning[];
          /** The final coerce attempt — exposes the failure reason on null. */
          coerce: CoerceResult;
          format: CellFormat;
      }
    | { type: 'error'; error: Error };

export interface RunCellWithFormatOptions extends RunCellOptions {
    format: CellFormat;
}

/**
 * Run a cell, then coerce the output per `format`. On shape failure on the
 * first pass, build a clarifying retry message (the original conversation
 * + the assistant's bad reply + a format-specific user clarification) and
 * try once more. If the second pass also fails, the final `done` event has
 * `formatted: null` and the failure reason exposed via `coerce`.
 *
 * `text` for free-form formats is the raw assistant prose with the citation
 * sentinel block stripped (just like `runCell`); markers are preserved.
 */
export async function* runCellWithFormat(
    opts: RunCellWithFormatOptions,
): AsyncIterable<FormattedCellEvent> {
    let messages = buildCellMessages({
        document: opts.document,
        documentLabel: opts.documentLabel,
        prompt: opts.column.prompt,
        format: opts.format,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        let accumulated = '';
        let llmFailed = false;
        try {
            for await (const chunk of opts.llm({ messages, signal: opts.signal })) {
                if (typeof chunk !== 'string' || chunk.length === 0) continue;
                accumulated += chunk;
                yield { type: 'token', text: chunk };
            }
        } catch (err) {
            yield {
                type: 'error',
                error: err instanceof Error ? err : new Error(String(err)),
            };
            llmFailed = true;
        }
        if (llmFailed) return;

        const parsed = parseResponse(accumulated, {
            knownDocs: [opts.document.handle],
        });
        const coerced = coerceCellOutput(opts.format, parsed.text);

        if (coerced.ok) {
            yield {
                type: 'done',
                text: parsed.text,
                formatted: coerced.value,
                citations: parsed.citations,
                warnings: parsed.warnings,
                coerce: coerced,
                format: opts.format,
            };
            return;
        }

        if (attempt === 0) {
            yield { type: 'retry', reason: coerced.reason, format: opts.format };
            messages = [
                ...messages,
                { role: 'assistant', content: accumulated },
                { role: 'user', content: retryPromptFor(opts.format, coerced.reason) },
            ];
            continue;
        }

        // Final pass also failed.
        yield {
            type: 'done',
            text: parsed.text,
            formatted: null,
            citations: parsed.citations,
            warnings: parsed.warnings,
            coerce: coerced,
            format: opts.format,
        };
        return;
    }
}
