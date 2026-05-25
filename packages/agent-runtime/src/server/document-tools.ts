import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import {
  documentDraftingTools, documentNavigationTools,
  InMemoryDocumentStore, MarkdownDocument,
} from '@teamsuzie/markdown-document';
import { convertFileToMarkdown } from '@teamsuzie/document-conversion';
import type { FileRecord, InMemoryFileStore } from './files-route.js';
import { buildCompareDocumentsTool } from './compare-documents-tool.js';
import { buildFindInDocumentTool } from './find-in-document-tool.js';
import { buildGenerateDocxFromSpecTool } from './generate-docx-tool.js';

export interface BuildDocumentToolsOptions {
  /** Active session id for this turn — closed over by the navigation/drafting tools. */
  sessionId: string;
  fileStore: InMemoryFileStore;
  docStore: InMemoryDocumentStore;
  /**
   * markitdown-agent base URL. When empty, `convert_to_markdown` still
   * works for DOCX (mammoth in-process), but other binary types and
   * `export_to_docx` are not registered.
   */
  markitdownBaseUrl: string;
  /**
   * When false, the drafting tools (`create_document`, `set_outline`,
   * `write_section`, `revise_section`, `append_section`, `delete_section`,
   * `export_to_docx`) are omitted. `convert_to_markdown` + navigation
   * tools are always included since they're read-only and harmless.
   * Default: true.
   */
  includeDrafting?: boolean;
  /** Optional fetch override (tests). */
  fetchImpl?: typeof fetch;
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function generateExportFileId(): string {
  return `file_export_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface ExportDocFromMarkdownOptions {
  sessionId: string;
  markdown: string;
  /** Stem only (with or without .docx). Sanitized before use. */
  filename: string;
  markitdownBaseUrl: string;
  fileStore: InMemoryFileStore;
  fetchImpl?: typeof fetch;
}

export interface ExportDocFromMarkdownResult {
  fileId: string;
  filename: string;
  downloadUrl: string;
}

/**
 * POST `markdown` to markitdown-agent's `/export/docx`, stash the
 * resulting bytes in `fileStore` under the given session, and return
 * a relative download URL. Shared by `documentDraftingTools.export_to_docx`
 * (model-driven export) and `createDocumentsRouter` (user-driven export
 * triggered from the ArtifactPanel).
 */
export async function exportDocFromMarkdown(
  opts: ExportDocFromMarkdownOptions,
): Promise<ExportDocFromMarkdownResult> {
  const { sessionId, markdown, filename, markitdownBaseUrl, fileStore, fetchImpl } = opts;
  if (!markitdownBaseUrl) {
    throw new Error('export_to_docx requires markitdown-agent to be configured');
  }
  const fetchFn = fetchImpl ?? fetch;
  const response = await fetchFn(`${markitdownBaseUrl}/export/docx`, {
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
  const fileId = generateExportFileId();
  const record: FileRecord = {
    id: fileId,
    sessionId,
    name: finalName,
    mimeType: DOCX_MIME,
    size: bytes.length,
    bytes,
    createdAt: Date.now(),
  };
  fileStore.put(record);
  return {
    fileId,
    filename: finalName,
    downloadUrl: `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/content`,
  };
}

/**
 * Build the per-turn drafting toolset:
 *  - `convert_to_markdown(file_id)` — puts the markdown into the docStore and
 *    returns `doc_id` + `_doc_state` so the model can refer to it without
 *    holding the body in context.
 *  - `documentNavigationTools(...)` — list/outline/read/search.
 *  - `documentDraftingTools(...)` with an `exportToDocx` that posts to
 *    markitdown-agent's `/export/docx` and stashes the DOCX in the file
 *    store (so the user can download via /api/files/:sessionId/:id/content).
 *
 * Lifted from suzielaw's `document-tools.ts:buildDocumentTools` (with the
 * `convert_to_markdown` description and tool shape preserved). Call this
 * per turn so the closure-captured sessionId stays fresh.
 */
export function buildDocumentTools(opts: BuildDocumentToolsOptions): AnyToolDefinition[] {
  const {
    sessionId, fileStore, docStore, markitdownBaseUrl, fetchImpl,
    includeDrafting = true,
  } = opts;

  const convertTool: AnyToolDefinition = {
    name: 'convert_to_markdown',
    description:
      'Convert a previously-uploaded binary file (DOCX, PDF, PPTX, XLSX, HTML, EPUB, ...) to a navigable markdown document. Call this when the user references the contents of a binary attachment. Returns a `doc_id` you then pass to `get_outline`, `read_section`, and `search_document`.',
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description:
            'File id from the [Attachments] block — the same id surfaced when the user uploaded the file.',
        },
      },
      required: ['file_id'],
      additionalProperties: false,
    },
    async execute(args: { file_id: string }) {
      const record = fileStore.get(sessionId, args.file_id);
      if (!record) throw new Error(`file_id not found in session: ${args.file_id}`);
      const markdown = await convertFileToMarkdown(record, {
        markitdownAgentBaseUrl: markitdownBaseUrl,
        fetchImpl,
      });
      const doc = new MarkdownDocument(markdown, record.name);
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

  const exportToDocx = async ({
    markdown,
    filename,
  }: {
    markdown: string;
    filename: string;
    docId: string;
  }) =>
    exportDocFromMarkdown({
      sessionId, markdown, filename, markitdownBaseUrl, fileStore, fetchImpl,
    });

  const tools: AnyToolDefinition[] = [
    convertTool,
    ...documentNavigationTools({ store: docStore, getSessionId: () => sessionId }),
    // Read-only "find a phrase in this uploaded file" tool. Useful for
    // citations + grounding even when drafting tools aren't enabled, so
    // it lives alongside the nav tools rather than behind the drafting
    // gate. DOCX paragraph indices match the redline-view, so a find
    // result anchors a subsequent edit without re-locating.
    buildFindInDocumentTool({ sessionId, fileStore, docStore }),
    // Two-document diff with downloadable tracked-change DOCX. Read-only
    // for the inputs (writes a new redline file under the same session).
    // Lives outside the drafting gate because "compare these two" is a
    // common question even for read-only review flows.
    buildCompareDocumentsTool({
      sessionId, fileStore, markitdownBaseUrl,
      author: 'AI assistant', fetchImpl,
    }),
  ];
  if (includeDrafting) {
    tools.push(
      ...documentDraftingTools({
        store: docStore,
        getSessionId: () => sessionId,
        ...(markitdownBaseUrl ? { exportToDocx } : {}),
      }),
      // Structured-deliverable generator (CP checklists, diligence
      // questionnaires, term-sheet tables). Sibling to the markdown
      // drafting flow; behind the same drafting gate because both are
      // about producing finished documents.
      buildGenerateDocxFromSpecTool({ sessionId, fileStore }),
    );
  }
  return tools;
}
