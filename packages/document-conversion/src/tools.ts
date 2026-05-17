import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { exportMarkdownToDocx } from './export.js';

/**
 * Minimal file-store interface the tool needs. Apps provide their own
 * implementation (drafter has InMemoryFileStore; suzielaw has the same shape).
 *
 * `get` may return `null` OR `undefined` so callers can use either convention
 * (drafter's InMemoryFileStore returns `undefined`; suzielaw returns `null`).
 */
export interface ConvertFileStore {
  get(
    sessionId: string,
    fileId: string,
  ):
    | {
        id: string;
        name: string;
        mimeType: string;
        bytes: Buffer;
      }
    | null
    | undefined;
  put(record: {
    id: string;
    sessionId: string;
    name: string;
    mimeType: string;
    size: number;
    bytes: Buffer;
    createdAt: number;
  }): void;
}

export interface BuildConvertToDocxToolOptions {
  sessionId: string;
  fileStore: ConvertFileStore;
  /** markitdown-agent base URL. Empty string disables the tool. */
  markitdownBaseUrl: string;
  /** Optional. Used to make download_url absolute. */
  originUrl?: string;
}

/**
 * Tool: `convert_to_docx`. Converts an uploaded markdown/text attachment to
 * a fresh .docx via markitdown-agent and stores the result back in the file
 * store. Returns the new `file_id` + `download_url`. Use this before calling
 * `propose_document_edits` on a non-.docx upload.
 *
 * Skips conversion if the input is already a .docx (returns the same file_id).
 */
export function buildConvertToDocxTool(opts: BuildConvertToDocxToolOptions): AnyToolDefinition {
  const { sessionId, fileStore, markitdownBaseUrl, originUrl = '' } = opts;
  return {
    name: 'convert_to_docx',
    description:
      'Convert a previously-uploaded markdown or plain-text file to a .docx (Word) file via markitdown-agent. Use this before `propose_document_edits` when the source is .md / .txt. Returns the new `file_id` and `download_url`. If the input is already .docx, returns the same file_id unchanged.',
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'File id of the markdown/text attachment to convert.',
        },
        filename: {
          type: 'string',
          description:
            'Optional name for the output (without extension). Defaults to the input filename stem.',
        },
      },
      required: ['file_id'],
      additionalProperties: false,
    },
    async execute(args: { file_id: string; filename?: string }) {
      if (!markitdownBaseUrl) {
        return { error: 'markitdown-agent is not configured; cannot convert.' };
      }
      const record = fileStore.get(sessionId, args.file_id);
      if (!record) return { error: `file_id not found in session: ${args.file_id}` };

      const lower = record.name.toLowerCase();
      const isDocx =
        lower.endsWith('.docx') ||
        record.mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (isDocx) {
        // Already .docx — no-op. Helps the LLM be safe calling this unconditionally.
        return {
          file_id: record.id,
          filename: record.name,
          download_url: `${originUrl}/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(record.id)}/content`,
          converted: false,
        };
      }

      const markdown = record.bytes.toString('utf-8');
      const stem = (args.filename ?? record.name).replace(/\.[^.]+$/, '');
      const docxBytes = await exportMarkdownToDocx({
        markdown,
        filename: stem,
        markitdownAgentBaseUrl: markitdownBaseUrl,
      });

      const newFileId = `file_convert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const filename = `${stem}.docx`;
      fileStore.put({
        id: newFileId,
        sessionId,
        name: filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: docxBytes.length,
        bytes: Buffer.from(docxBytes),
        createdAt: Date.now(),
      });

      return {
        file_id: newFileId,
        filename,
        download_url: `${originUrl}/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(newFileId)}/content`,
        converted: true,
      };
    },
  };
}
