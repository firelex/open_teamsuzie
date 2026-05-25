import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import {
  generateDocx,
  type GenerateDocxSection,
  type GenerateDocxSpec,
} from '@teamsuzie/docx';
import type { FileRecord, InMemoryFileStore } from './files-route.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface BuildGenerateDocxToolOptions {
  /** Active session id for this turn — bucket for the generated file. */
  sessionId: string;
  fileStore: InMemoryFileStore;
  /**
   * Optional versions store. When set, each successful generation
   * records a `source: 'generated'` row so the user can compare runs
   * or restore an earlier generation.
   */
  versionsStore?: {
    addVersion(input: {
      externalDocId: string;
      parentId?: string | null;
      source: 'generated';
      storageId: string;
      byteSize?: number | null;
      notes?: string | null;
    }): { id: string };
  };
}

/**
 * Chat tool that synthesizes a brand-new `.docx` from a structured spec
 * (sections, optional headings, paragraphs, tables).
 *
 * Distinct from the markdown drafting flow (`create_document` /
 * `write_section` / `export_to_docx`) which is the default for free-form
 * prose drafts; this is for **structured deliverables** where the model
 * needs to lay out section headings, body prose, and tables explicitly
 * (e.g. CP checklists, diligence questionnaires, term sheets with
 * pricing tables).
 *
 * Ported from suzielaw's `tools/generate-docx.ts`. Wire shape matches:
 * `{ download_url, download_file_id, download_filename, section_count,
 * version_id? }`.
 */
export function buildGenerateDocxFromSpecTool(
  opts: BuildGenerateDocxToolOptions,
): AnyToolDefinition {
  const { sessionId, fileStore, versionsStore } = opts;

  return {
    name: 'generate_docx',
    description:
      "Synthesize a NEW Word (.docx) document from a structured spec — sections with optional headings, prose paragraphs, and tables. Use this when the desired output is a structured tabular/checklist deliverable (e.g. CP checklist with four-column condition tables, diligence questionnaire with rigid section layout). For free-form prose drafting (memos, agreements, letters, opinions, term sheets, etc.) use the markdown drafting tools (create_document → write_section → export_to_docx) instead — those let you iterate section-by-section in markdown, which is easier to revise. Returns a `download_url` to the generated file. Always include the `download_url` verbatim as a clickable link in your reply.",
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Document title — rendered uppercased and centered at the top, also used to derive the filename.',
        },
        orientation: {
          type: 'string',
          enum: ['portrait', 'landscape'],
          description:
            "Page orientation. Default 'portrait'. Use 'landscape' for wide tables (e.g. CP checklists with 4+ columns).",
        },
        sections: {
          type: 'array',
          description:
            'Document sections rendered top-to-bottom. Each section may contain a heading, paragraphs, a table, or any combination. An empty array still produces a valid doc with just the title.',
          items: {
            type: 'object',
            properties: {
              page_break_before: {
                type: 'boolean',
                description:
                  'Force a page break before this section (e.g. signature pages).',
              },
              heading: {
                type: 'object',
                description:
                  'Optional section heading. Auto-numbered "1.", "1.1.", "1.1.1." Level 1 is uppercased; levels 2 and 3 keep the supplied casing.',
                properties: {
                  text: { type: 'string' },
                  level: {
                    type: 'integer',
                    enum: [1, 2, 3],
                    description: 'Heading depth: 1, 2, or 3.',
                  },
                },
                required: ['text', 'level'],
                additionalProperties: false,
              },
              paragraphs: {
                type: 'array',
                description:
                  'Body paragraphs. Each entry is one paragraph. Lines beginning with "- ", "* ", or "• " render as bullets; otherwise as plain prose.',
                items: { type: 'string' },
              },
              table: {
                type: 'object',
                description:
                  'Optional table. Headers row is shaded + bold; body rows plain. Rows shorter than headers are padded; longer rows are truncated. No rowspan / colspan / nested tables.',
                properties: {
                  headers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Column header labels.',
                  },
                  rows: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'string' } },
                    description:
                      'Array of rows, each row an array of cell strings (one per header).',
                  },
                },
                required: ['headers', 'rows'],
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'sections'],
      additionalProperties: false,
    },
    async execute(args: {
      title: string;
      orientation?: 'portrait' | 'landscape';
      sections: Array<{
        page_break_before?: boolean;
        heading?: { text: string; level: 1 | 2 | 3 };
        paragraphs?: string[];
        table?: { headers: string[]; rows: string[][] };
      }>;
    }) {
      if (typeof args.title !== 'string' || !args.title.trim()) {
        throw new Error('title is required');
      }
      if (!Array.isArray(args.sections)) {
        throw new Error('sections must be an array');
      }

      const sections: GenerateDocxSection[] = args.sections.map((s) => {
        const out: GenerateDocxSection = {};
        if (s.page_break_before) out.pageBreakBefore = true;
        if (s.heading) out.heading = s.heading;
        if (s.paragraphs) out.paragraphs = s.paragraphs;
        if (s.table) out.table = s.table;
        return out;
      });

      const spec: GenerateDocxSpec = {
        title: args.title,
        sections,
      };
      if (args.orientation) spec.orientation = args.orientation;

      const bytes = await generateDocx(spec);

      const safeTitle =
        args.title
          .replace(/[^a-zA-Z0-9 _-]/g, '')
          .trim()
          .replace(/\s+/g, '_')
          .slice(0, 64) || 'document';
      const filename = `${safeTitle}.docx`;
      const fileId = `file_generated_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const record: FileRecord = {
        id: fileId,
        sessionId,
        name: filename,
        mimeType: DOCX_MIME,
        size: bytes.length,
        bytes,
        createdAt: Date.now(),
      };
      fileStore.put(record);

      // Each run is its own logical document — `externalDocId = fileId`
      // so re-runs of the same workflow produce siblings, not children.
      // (Treating multiple CP checklists as branches off one logical doc
      // would conflate distinct deals.) Best-effort.
      let versionId: string | undefined;
      if (versionsStore) {
        try {
          const v = versionsStore.addVersion({
            externalDocId: fileId,
            parentId: null,
            source: 'generated',
            storageId: fileId,
            byteSize: bytes.length,
            notes: `generate_docx — ${args.title}`,
          });
          versionId = v.id;
        } catch (err) {
          console.warn(
            '[generate_docx] addVersion failed:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      return {
        download_url: `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/content`,
        download_file_id: fileId,
        download_filename: filename,
        section_count: sections.length,
        version_id: versionId,
      };
    },
  };
}
