/**
 * Allowlist used by the persona porter to filter PERSONA.md frontmatter
 * `allowedTools` against the set of tool names the generic runtime
 * actually exposes today.
 *
 * Sources audited (see plan Task 1 — 2026-05-29):
 *  - @teamsuzie/agent-loop  built-ins (packages/agent-loop/src/tools/)
 *  - @teamsuzie/markdown-document navigation + drafting tools
 *    (packages/markdown-document/src/navigation-tools.ts + drafting-tools.ts)
 *  - @teamsuzie/agent-runtime  server-built tools
 *    (packages/agent-runtime/src/server/document-tools.ts +
 *     find-in-document-tool.ts + blackline-documents-tool.ts +
 *     compare-documents-tool.ts + generate-docx-tool.ts)
 *
 * Dropped from plan starter list (not found in any source file):
 *  - replicate_document   — no implementation located
 *  - propose_document_edits — no implementation located
 *
 * Added vs plan starter list (found in source but not in starter):
 *  - delete_section       — packages/markdown-document/src/drafting-tools.ts
 *  - blackline_documents  — packages/agent-runtime/src/server/blackline-documents-tool.ts
 *  - generate_docx        — packages/agent-runtime/src/server/generate-docx-tool.ts
 *
 * If a new tool ships upstream, add its name here and re-run the porter.
 */
export const RUNTIME_SUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  // ── @teamsuzie/agent-loop built-ins ────────────────────────────────────
  'vector_search',
  'http_request',
  'propose_action',

  // ── @teamsuzie/markdown-document — navigation tools ────────────────────
  // packages/markdown-document/src/navigation-tools.ts
  'list_documents',
  'get_outline',
  'read_section',
  'search_document',

  // ── @teamsuzie/markdown-document — drafting tools ──────────────────────
  // packages/markdown-document/src/drafting-tools.ts
  // (only registered when manifest includeDrafting=true; present by default)
  'create_document',
  'set_outline',
  'write_section',
  'append_section',
  'revise_section',
  'delete_section',
  'export_to_docx',

  // ── @teamsuzie/agent-runtime — document tools ──────────────────────────
  // packages/agent-runtime/src/server/document-tools.ts
  'convert_to_markdown',

  // packages/agent-runtime/src/server/find-in-document-tool.ts
  'find_in_document',

  // packages/agent-runtime/src/server/blackline-documents-tool.ts
  'blackline_documents',

  // packages/agent-runtime/src/server/compare-documents-tool.ts
  'compare_documents',

  // packages/agent-runtime/src/server/generate-docx-tool.ts
  'generate_docx',
]);
