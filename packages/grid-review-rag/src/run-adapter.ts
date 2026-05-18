import {
  prepareDocumentForPrompt,
  type PreparedDocument,
} from '@teamsuzie/citations';
import {
  runCellWithFormat,
  type LlmStream,
  type RunCellAdapter,
  type CellEvent,
} from '@teamsuzie/grid-review';
import type { KbSearchHit, WorkspaceRag } from '@teamsuzie/kb';

export interface RagAdapterOptions {
  /** WorkspaceRag instance to query for indexed-doc retrieval. */
  rag: WorkspaceRag;
  /**
   * Resolve a workspace doc's raw bytes (used only for the fallback path
   * when the doc isn't indexed — full-doc markdown then prompts the LLM).
   * Return null if the doc has no source bytes (post-index discard).
   */
  loadFileBytes: (
    workspaceId: string,
    externalDocId: string,
  ) => Promise<{ bytes: Buffer | Uint8Array; name: string; mimeType: string } | null>;
  /**
   * Rewrite the column prompt as a hypothetical-answer sentence for HyDE
   * retrieval. Callers usually pass `(q, fmt) => rewriteQueryAsHypothetical(q, fmt, { ... })`.
   * If this throws, the adapter falls back to embedding the raw prompt.
   */
  hydeRewrite: (question: string, formatKey: string) => Promise<string>;
  /**
   * LLM stream — receives the assembled chat messages, returns an
   * async iterable of token chunks. Typically the result of `makeStreamCompletion`.
   */
  llmStream: LlmStream;
  /** markitdown-agent base URL for the legacy full-doc fallback. */
  markitdownBaseUrl: string;
  /** Top-K chunks retrieved per cell run. Defaults to 6. */
  topK?: number;
  /**
   * Optional fallback path that converts file bytes → markdown when an
   * unindexed document is encountered. Default uses `@teamsuzie/document-conversion`'s
   * `convertToMarkdown`. Suzielaw passes its own implementation that
   * tags page breaks.
   */
  convertToMarkdown?: (
    record: { bytes: Buffer | Uint8Array; name: string; mimeType: string },
  ) => Promise<{ markdown: string; pageBreaks?: number[] }>;
}

/**
 * Build a RAG-driven `RunCellAdapter` for `@teamsuzie/grid-review`.
 *
 * For each cell run:
 *   1. If the doc is indexed in `WorkspaceRag` → HyDE-rewrite the column
 *      prompt → retrieve top-K chunks → assemble a `PreparedDocument`
 *      whose `marked` body is the labelled excerpts.
 *   2. Otherwise (legacy fallback) → load file bytes → convertToMarkdown →
 *      `prepareDocumentForPrompt` on the full doc.
 *   3. Pipe through `runCellWithFormat` with the caller-supplied LLM stream.
 *
 * Extracted from suzielaw 2026-05-18. Removes suzielaw-specific token
 * metering and getSessionUser coupling; callers wire those externally via
 * the `llmStream` factory (which can return a metered `fetchImpl`).
 */
export function buildRagRunCellAdapter(opts: RagAdapterOptions): RunCellAdapter {
  const topK = opts.topK ?? 6;
  const convertFallback = opts.convertToMarkdown ?? defaultConvert(opts.markitdownBaseUrl);

  return async function* runReviewCell({ workspaceId, document, column, signal }): AsyncIterable<CellEvent> {
    const llm = opts.llmStream;

    let prepared: PreparedDocument;
    try {
      if (opts.rag.hasIndex(workspaceId, document.externalDocId)) {
        let retrievalQuery = column.prompt;
        try {
          retrievalQuery = await opts.hydeRewrite(column.prompt, column.format);
        } catch (err) {
          console.warn(
            '[grid-review-rag] HyDE rewrite failed, falling back to raw prompt:',
            err instanceof Error ? err.message : err,
          );
        }

        const hits = await opts.rag.searchInDoc(
          workspaceId,
          document.externalDocId,
          retrievalQuery,
          topK,
        );
        yield {
          type: 'retrieved',
          summary:
            hits.length === 0
              ? `No relevant passages retrieved from ${document.name}`
              : `Retrieved ${hits.length} passage${hits.length === 1 ? '' : 's'} from ${document.name}`,
          chunkCount: hits.length,
          chunks: hits.map((h) => ({ content: h.chunk.content, distance: h.distance })),
          retrievalQuery,
        };
        prepared = synthesizePrepared(document.externalDocId, hits);
      } else {
        const record = await opts.loadFileBytes(workspaceId, document.externalDocId);
        if (!record) {
          yield { type: 'error', error: new Error(`document not found (workspace=${workspaceId}, doc=${document.externalDocId})`) };
          return;
        }
        yield { type: 'retrieved', summary: `Indexing not ready — using full document ${document.name}` };
        const { markdown } = await convertFallback(record);
        prepared = prepareDocumentForPrompt(markdown, [], { handle: document.externalDocId });
      }
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
      return;
    }

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
        yield { type: 'token', text: `\n\n[retrying — ${event.reason}]\n\n` };
      } else if (event.type === 'done') {
        yield {
          type: 'done',
          text: event.formatted ?? event.text,
          citations: event.citations,
          warnings: event.warnings,
        };
      } else if (event.type === 'error') {
        yield event;
      }
    }
  };
}

function synthesizePrepared(handle: string, hits: KbSearchHit[]): PreparedDocument {
  if (hits.length === 0) {
    const empty =
      'No relevant passages were retrieved from this document for the question.\n' +
      'If the answer requires content not shown here, say so plainly.';
    return { handle, marked: empty, text: empty, pageBreaks: [] };
  }
  const sections: string[] = [
    'The following passages were retrieved from the source document as most relevant to the question. They are excerpts, not the full document — quote verbatim from these passages only.',
    '',
  ];
  for (let i = 0; i < hits.length; i++) {
    sections.push(`[Excerpt ${i + 1}]`);
    sections.push(hits[i]!.chunk.content.trim());
    sections.push('');
  }
  const marked = sections.join('\n');
  return { handle, marked, text: marked, pageBreaks: [] };
}

function defaultConvert(markitdownBaseUrl: string) {
  return async function (record: { bytes: Buffer | Uint8Array; name: string; mimeType: string }) {
    const { convertToMarkdown } = await import('@teamsuzie/document-conversion');
    const result = await convertToMarkdown(record.bytes, {
      mime: record.mimeType,
      filename: record.name,
      markitdownAgentBaseUrl: markitdownBaseUrl,
    });
    return { markdown: result.markdown };
  };
}
