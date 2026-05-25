import { prepareDocumentForPrompt } from '@teamsuzie/citations';
import { convertToMarkdown } from '@teamsuzie/document-conversion';
import {
    runCellWithFormat,
    type CellEvent,
    type RunCellAdapter,
} from '@teamsuzie/grid-review';
import { makeStreamCompletion } from '@teamsuzie/grid-review-rag';

import type { InMemoryFileStore } from './files-route.js';

export interface BuildLocalRunCellAdapterOptions {
    fileStore: InMemoryFileStore;
    markitdownBaseUrl: string;
    agent: {
        baseUrl: string;
        apiKey?: string;
        model: string;
        extraBody?: Record<string, unknown>;
    };
    fetchImpl?: typeof fetch;
}

/**
 * A non-KB run adapter for matter-scoped grid reviews. For each cell:
 *
 *   1. Load the doc bytes from the matter's file bucket.
 *   2. Convert to markdown (mammoth for DOCX, markitdown-agent otherwise).
 *   3. Prepare the full doc for prompting (no retrieval — every cell
 *      sees the whole document).
 *   4. Stream the cell via `runCellWithFormat` against `opts.agent`'s
 *      OpenAI-compatible chat endpoint, with `extraBody` inherited so
 *      Qwen's enable_thinking knob etc. flow through (memory:
 *      "inherit opts.agent.extraBody on every secondary LLM endpoint").
 *
 * The trade-off vs. `buildRagRunCellAdapter` (from
 * `@teamsuzie/grid-review-rag`): no retrieval = the model sees the
 * whole doc every cell, which is slow + token-hungry on long docs.
 * Suitable for matters under ~50 pages or as a "works today" baseline
 * while the KB module ships.
 *
 * Wired by `agent-runtime/server/index.ts` when both `markitdownBaseUrl`
 * and `opts.agent` are configured. Without them, the package's default
 * 501 stays — the host UI surfaces a "no run adapter configured" toast.
 */
export function buildLocalRunCellAdapter(
    opts: BuildLocalRunCellAdapterOptions,
): RunCellAdapter {
    const llm = makeStreamCompletion({
        baseUrl: opts.agent.baseUrl,
        apiKey: opts.agent.apiKey,
        model: opts.agent.model,
        extraBody: opts.agent.extraBody,
        fetchImpl: opts.fetchImpl,
    });

    return async function* runReviewCell({
        workspaceId,
        document,
        column,
        signal,
    }): AsyncIterable<CellEvent> {
        const record = opts.fileStore.get(workspaceId, document.externalDocId);
        if (!record) {
            yield {
                type: 'error',
                error: new Error(
                    `document not found (workspace=${workspaceId}, doc=${document.externalDocId})`,
                ),
            };
            return;
        }
        yield {
            type: 'retrieved',
            summary: `Reading ${document.name} (full document)`,
        };
        let markdown: string;
        try {
            const result = await convertToMarkdown(record.bytes, {
                mime: record.mimeType,
                filename: record.name,
                markitdownAgentBaseUrl: opts.markitdownBaseUrl,
                fetchImpl: opts.fetchImpl,
            });
            markdown = result.markdown;
        } catch (err) {
            yield {
                type: 'error',
                error: err instanceof Error ? err : new Error(String(err)),
            };
            return;
        }
        const prepared = prepareDocumentForPrompt(markdown, [], {
            handle: document.externalDocId,
        });

        for await (const event of runCellWithFormat({
            document: prepared,
            documentLabel: document.name,
            column: { prompt: column.prompt },
            format: column.format,
            llm,
            signal,
        })) {
            if (event.type === 'token') {
                yield { type: 'token', text: event.text };
            } else if (event.type === 'retry') {
                yield {
                    type: 'token',
                    text: `\n\n[retrying — ${event.reason}]\n\n`,
                };
            } else if (event.type === 'done') {
                yield {
                    type: 'done',
                    text: event.formatted ?? event.text,
                    citations: event.citations,
                    warnings: event.warnings,
                };
            } else if (event.type === 'error') {
                yield { type: 'error', error: event.error };
            }
        }
    };
}
