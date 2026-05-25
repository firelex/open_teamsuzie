import type { AnyToolDefinition, ToolContext } from '@teamsuzie/agent-loop';
import { convertToMarkdown } from './convert.js';
import type { ConvertFileStore } from './tools.js';

export interface BuildConvertToMarkdownToolOptions {
  fileStore: ConvertFileStore;
  /** markitdown-agent base URL. Empty string disables the tool's network call. */
  markitdownBaseUrl: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Tool: `convert_to_markdown`. Reads a previously-uploaded binary
 * attachment (DOCX/PDF/PPTX/etc.) and returns its markdown
 * representation. The model should call this whenever the user has
 * attached such a file and asked anything about its contents.
 *
 * The per-turn `sessionId` comes from {@link ToolContext.sessionId};
 * the chat router sets it from the request body. Without it the tool
 * returns a structured error so the model can recover gracefully.
 */
export function buildConvertToMarkdownTool(
  opts: BuildConvertToMarkdownToolOptions,
): AnyToolDefinition {
  return {
    name: 'convert_to_markdown',
    description:
      'Convert a previously-uploaded binary attachment (DOCX, PDF, PPTX, etc.) into markdown. Use this whenever the user has attached such a file AND asked anything about its contents — without calling this, you cannot read the file. Returns the markdown body, the source filename, and the source MIME type. The same file_id can be passed to `propose_document_edits` afterward (only for .docx).',
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'File id from the [Attachments] block to convert.',
        },
      },
      required: ['file_id'],
      additionalProperties: false,
    },
    async execute(args: { file_id: string }, ctx: ToolContext) {
      const sessionId = ctx.sessionId;
      if (!sessionId) {
        return { error: 'tool requires ctx.sessionId; chat router did not propagate it' };
      }
      const record = opts.fileStore.get(sessionId, args.file_id);
      if (!record) {
        return { error: `file_id not found in session: ${args.file_id}` };
      }
      try {
        const { markdown } = await convertToMarkdown(record.bytes, {
          mime: record.mimeType,
          filename: record.name,
          markitdownAgentBaseUrl: opts.markitdownBaseUrl,
          fetchImpl: opts.fetchImpl,
        });
        return {
          markdown,
          source_filename: record.name,
          mime_type: record.mimeType,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'convert_to_markdown failed',
        };
      }
    },
  };
}
