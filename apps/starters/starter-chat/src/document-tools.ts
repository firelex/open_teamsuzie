import {
  InMemoryDocumentStore,
  MarkdownDocument,
  documentDraftingTools,
  documentNavigationTools,
} from '@teamsuzie/markdown-document';
import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import type { InMemoryFileStore, FileRecord } from './files.js';

interface BuildOptions {
  /** Active session id (per chat turn). */
  sessionId: string;
  fileStore: InMemoryFileStore;
  docStore: InMemoryDocumentStore;
  /** markitdown-agent base URL, e.g. `http://localhost:3013`. Empty string disables conversion tools. */
  markitdownBaseUrl: string;
}

/**
 * Build the per-session tool set that lets the agent navigate uploaded
 * documents and draft new ones. Concretely:
 *
 * - `convert_to_markdown(file_id)` — calls markitdown-agent to turn a binary
 *   in the file store (DOCX/PDF/etc.) into a MarkdownDocument in the doc store
 *   and returns its `doc_id`. The agent calls this lazily, only when the user
 *   refers to the document's contents.
 *
 * - `documentNavigationTools(...)` — read-only navigation: list, outline, read
 *   section, search. Use these to answer questions or summarize.
 *
 * - `documentDraftingTools(...)` with an `exportToDocx` callback wired to
 *   markitdown-agent's `/export/docx`. The exported DOCX lands back in the
 *   file store as a session file, so the user can download via the same
 *   `/api/files/:sessionId/:id/content` endpoint they use for uploads.
 *
 * Returns an empty array if `markitdownBaseUrl` is unset — conversion tools
 * require the sidecar service.
 */
export function buildDocumentTools(opts: BuildOptions): AnyToolDefinition[] {
  const { sessionId, fileStore, docStore, markitdownBaseUrl } = opts;
  if (!markitdownBaseUrl) {
    // No conversion service configured — surface navigation+drafting on
    // documents the app put in the store directly, but no convert/export.
    return [
      ...documentNavigationTools({ store: docStore, getSessionId: () => sessionId }),
      ...documentDraftingTools({ store: docStore, getSessionId: () => sessionId }),
    ];
  }

  const convertTool: AnyToolDefinition = {
    name: 'convert_to_markdown',
    description:
      "Convert a previously-uploaded binary file (DOCX, PDF, PPTX, XLSX, HTML, EPUB, ...) to a navigable markdown document. Call this when the user references the contents of a binary attachment. Returns a `doc_id` you then pass to `get_outline`, `read_section`, and `search_document`.",
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'File id from the [Attachments] block — the same id surfaced when the user uploaded the file.',
        },
      },
      required: ['file_id'],
      additionalProperties: false,
    },
    async execute(args: { file_id: string }) {
      const record = fileStore.get(sessionId, args.file_id);
      if (!record) throw new Error(`file_id not found in session: ${args.file_id}`);

      const form = new FormData();
      form.append(
        'file',
        new Blob([record.bytes], { type: record.mimeType }),
        record.name,
      );

      const response = await fetch(`${markitdownBaseUrl}/convert`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`markitdown-agent /convert returned ${response.status}: ${text.slice(0, 200)}`);
      }
      const data = (await response.json()) as { filename: string; markdown: string };
      const doc = new MarkdownDocument(data.markdown, record.name);
      const docId = docStore.put(sessionId, doc);
      return {
        doc_id: docId,
        title: doc.title,
        heading_count: doc.getHeadings().length,
        size: doc.getMarkdown().length,
        _doc_state: { doc_id: docId, title: doc.title, markdown: doc.getMarkdown() },
      };
    },
  };

  // Closure captures sessionId; called by export_to_docx.
  const exportToDocx = async ({
    markdown,
    filename,
  }: {
    markdown: string;
    filename: string;
    docId: string;
  }) => {
    const response = await fetch(`${markitdownBaseUrl}/export/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, filename }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `markitdown-agent /export/docx returned ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const finalName = filename.endsWith('.docx') ? filename : `${filename}.docx`;
    const fileId = `file_export_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const record: FileRecord = {
      id: fileId,
      sessionId,
      name: finalName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: bytes.length,
      bytes,
      createdAt: Date.now(),
    };
    fileStore.put(record);

    return {
      file_id: fileId,
      filename: finalName,
      download_url: `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/content`,
    };
  };

  return [
    convertTool,
    ...documentNavigationTools({ store: docStore, getSessionId: () => sessionId }),
    ...documentDraftingTools({
      store: docStore,
      getSessionId: () => sessionId,
      exportToDocx,
    }),
  ];
}
