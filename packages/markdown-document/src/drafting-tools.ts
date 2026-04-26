import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { MarkdownDocument } from './document.js';
import type { InMemoryDocumentStore } from './store.js';

/**
 * Read-only snapshot of a document's current state. Tool implementations
 * stamp this onto their result as `_doc_state` so the chat client can
 * present a live "artifact panel" without polling — every mutation surfaces
 * the updated body inline with the SSE tool_result event.
 */
function buildDocState(doc: MarkdownDocument, docId: string) {
  return {
    doc_id: docId,
    title: doc.title,
    markdown: doc.getMarkdown(),
  };
}

interface DraftingToolOptions {
  store: InMemoryDocumentStore;
  /** Resolves the active session id for this turn. */
  getSessionId: () => string;
  /**
   * Optional async DOCX exporter. Receives the markdown body and a suggested
   * filename, returns something the agent can hand the user (download URL,
   * file id, etc.). When omitted, `export_to_docx` is not registered.
   */
  exportToDocx?: (input: { markdown: string; filename: string; docId: string }) => Promise<{
    downloadUrl?: string;
    fileId?: string;
    filename?: string;
  }>;
}

/**
 * Read+write tools for an agent drafting a markdown document and (optionally)
 * exporting it to DOCX at the end. Compose alongside
 * {@link documentNavigationTools} when you want the same agent to also answer
 * questions about the document it's writing.
 *
 * Recommended drafting flow (encode in your system prompt):
 *  1. `create_document(title)` → get doc_id
 *  2. `set_outline(doc_id, [...])` — propose a TOC and confirm with the user
 *  3. For each section, `write_section(doc_id, heading, content)`. Read
 *     neighbors first with `read_section` to maintain coherence.
 *  4. `revise_section` for follow-up edits.
 *  5. `export_to_docx(doc_id, filename)` when finished.
 */
export function documentDraftingTools({
  store,
  getSessionId,
  exportToDocx,
}: DraftingToolOptions): AnyToolDefinition[] {
  const tools: AnyToolDefinition[] = [
    {
      name: 'create_document',
      description:
        'Start a new empty markdown document for drafting. Returns its id; pass that id to subsequent tools.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title shown in list_documents and the export filename.' },
        },
        required: ['title'],
        additionalProperties: false,
      },
      async execute(args: { title: string }) {
        const doc = new MarkdownDocument('', args.title);
        const docId = store.put(getSessionId(), doc);
        return { doc_id: docId, title: doc.title, _doc_state: buildDocState(doc, docId) };
      },
    },
    {
      name: 'set_outline',
      description:
        'Replace the document with empty sections at the given headings. Use early in the drafting flow to lock the table of contents before filling.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          headings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                level: { type: 'integer', minimum: 1, maximum: 6 },
                text: { type: 'string' },
              },
              required: ['level', 'text'],
              additionalProperties: false,
            },
            description: 'Ordered list of headings to seed the document with.',
          },
        },
        required: ['doc_id', 'headings'],
        additionalProperties: false,
      },
      async execute(args: { doc_id: string; headings: { level: number; text: string }[] }) {
        const sessionId = getSessionId();
        const doc = store.get(sessionId, args.doc_id);
        if (!doc) throw new Error(`Document not found: ${args.doc_id}`);
        doc.setOutline(args.headings);
        store.touch(sessionId, args.doc_id);
        return {
          ok: true,
          headings: doc.getHeadings(),
          _doc_state: buildDocState(doc, args.doc_id),
        };
      },
    },
    {
      name: 'write_section',
      description:
        'Replace the body of an existing section. The heading line stays; pass `body` as the markdown content beneath it.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          heading: {
            type: 'string',
            description: 'Heading text (substring, case-insensitive) or numeric path like "2.1".',
          },
          body: { type: 'string', description: 'Markdown content to place under the heading.' },
        },
        required: ['doc_id', 'heading', 'body'],
        additionalProperties: false,
      },
      async execute(args: { doc_id: string; heading: string; body: string }) {
        const sessionId = getSessionId();
        const doc = store.get(sessionId, args.doc_id);
        if (!doc) throw new Error(`Document not found: ${args.doc_id}`);
        const ok = doc.writeSection(args.heading, args.body);
        if (!ok) return { ok: false, error: `Section not found: ${args.heading}` };
        store.touch(sessionId, args.doc_id);
        return { ok: true, _doc_state: buildDocState(doc, args.doc_id) };
      },
    },
    {
      name: 'append_section',
      description:
        'Add a new section at the end of the document. Use during drafting when you need a heading not in the original outline.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          level: { type: 'integer', minimum: 1, maximum: 6, description: 'Heading level 1..6.' },
          heading: { type: 'string', description: 'Heading text.' },
          body: { type: 'string', description: 'Optional initial body. Empty by default.' },
        },
        required: ['doc_id', 'level', 'heading'],
        additionalProperties: false,
      },
      async execute(args: { doc_id: string; level: number; heading: string; body?: string }) {
        const sessionId = getSessionId();
        const doc = store.get(sessionId, args.doc_id);
        if (!doc) throw new Error(`Document not found: ${args.doc_id}`);
        const heading = doc.appendSection(args.level, args.heading, args.body ?? '');
        store.touch(sessionId, args.doc_id);
        return { ok: true, path: heading.path, _doc_state: buildDocState(doc, args.doc_id) };
      },
    },
    {
      name: 'revise_section',
      description:
        'Read the current body of a section and return it for the model to revise. The model is expected to follow up with `write_section` containing the revised body. Pair with explicit instructions in your system prompt.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          heading: { type: 'string' },
        },
        required: ['doc_id', 'heading'],
        additionalProperties: false,
      },
      async execute(args: { doc_id: string; heading: string }) {
        const doc = store.get(getSessionId(), args.doc_id);
        if (!doc) throw new Error(`Document not found: ${args.doc_id}`);
        const section = doc.readSection(args.heading);
        if (!section) return { found: false };
        return {
          found: true,
          path: section.heading.path,
          heading: section.heading.text,
          current_body: section.body,
        };
      },
    },
    {
      name: 'delete_section',
      description: 'Remove a section (heading + body) from the document.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          heading: { type: 'string' },
        },
        required: ['doc_id', 'heading'],
        additionalProperties: false,
      },
      async execute(args: { doc_id: string; heading: string }) {
        const sessionId = getSessionId();
        const doc = store.get(sessionId, args.doc_id);
        if (!doc) throw new Error(`Document not found: ${args.doc_id}`);
        const ok = doc.deleteSection(args.heading);
        if (ok) store.touch(sessionId, args.doc_id);
        return { ok, _doc_state: buildDocState(doc, args.doc_id) };
      },
    },
  ];

  if (exportToDocx) {
    tools.push({
      name: 'export_to_docx',
      description:
        'Final step: convert the markdown document to a DOCX file. Returns a download URL or file id the user can fetch.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          filename: { type: 'string', description: 'Suggested filename without extension.' },
        },
        required: ['doc_id'],
        additionalProperties: false,
      },
      async execute(args: { doc_id: string; filename?: string }) {
        const doc = store.get(getSessionId(), args.doc_id);
        if (!doc) throw new Error(`Document not found: ${args.doc_id}`);
        const filename = (args.filename ?? doc.title ?? 'document').replace(/[^\w.-]+/g, '_');
        const result = await exportToDocx({
          markdown: doc.getMarkdown(),
          filename,
          docId: args.doc_id,
        });
        return { ok: true, ...result, _doc_state: buildDocState(doc, args.doc_id) };
      },
    });
  }

  return tools;
}
