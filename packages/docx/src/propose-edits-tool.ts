import type { AnyToolDefinition, ToolContext } from '@teamsuzie/agent-loop';
import { proposeDocumentEdits } from './propose-edits.js';

export interface ProposeEditsToolFileRecord {
  id: string;
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  bytes: Buffer;
  createdAt: number;
}

export interface ProposeEditsToolFileStore {
  get(sessionId: string, fileId: string): ProposeEditsToolFileRecord | undefined | null;
  put(record: ProposeEditsToolFileRecord): void;
}

export interface ProposeEditsToolVersionsStore {
  addVersion(input: {
    externalDocId: string;
    parentId?: string | null;
    source: 'proposal';
    storageId: string;
    byteSize?: number | null;
    notes?: string | null;
  }): { id: string };
}

export interface BuildProposeDocumentEditsToolOptions {
  fileStore: ProposeEditsToolFileStore;
  versionsStore: ProposeEditsToolVersionsStore;
  /** Stamped on `<w:ins>`/`<w:del>` author attributes (Word displays in revision pane). */
  author: string;
  /**
   * Build the URL the model returns to the user as a clickable
   * download link. Receives the new proposal file's sessionId + fileId.
   * Return a relative URL (e.g. `/api/files/.../content`) — the client
   * resolves against window.location.
   */
  buildDownloadUrl(sessionId: string, fileId: string): string;
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isDocx(record: ProposeEditsToolFileRecord): boolean {
  return record.name.toLowerCase().endsWith('.docx') || record.mimeType === DOCX_MIME;
}

function generateProposalId(): string {
  return `file_proposal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function proposalFilename(sourceName: string): string {
  const stem = sourceName.replace(/\.docx$/i, '');
  return `${stem} (redline).docx`;
}

export function buildProposeDocumentEditsTool(
  opts: BuildProposeDocumentEditsToolOptions,
): AnyToolDefinition {
  return {
    name: 'propose_document_edits',
    description:
      'Propose tracked-change edits to a SINGLE previously-uploaded DOCX (chat-driven redline against a base contract). **Use this whenever the user asks you to "redline", "edit", "revise", "amend", "negotiate against", "mark up", or "make changes to" a document, OR when the user asks for changes from a particular party\'s perspective (e.g., "redline this NDA from buyer\'s perspective").** Each edit is content-keyed: a `find` substring + `context_before` and `context_after` (5–15 words on each side, taken verbatim from the document) for disambiguation. Use empty `find` for a pure insertion at the position where context_before meets context_after. Returns a `download_url` to a Word-openable .docx with native `<w:ins>` / `<w:del>` tracked changes (accept-all in Word reproduces your proposed edits; reject-all reproduces the original). Always include `download_url` verbatim as a clickable link in your reply. Per-edit `errors[]` lists any edits that failed to apply (`not_found`, `ambiguous`, `overlaps`); when an edit fails, retry with more disambiguating context.',
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description:
            "The DOCX file_id from the [Attachments] block to edit. Must be a .docx (we can't write tracked changes to PDFs).",
        },
        edits: {
          type: 'array',
          description:
            'List of content-keyed edits. Each is a find/replace with surrounding context for disambiguation.',
          items: {
            type: 'object',
            properties: {
              find: {
                type: 'string',
                description:
                  'The exact substring to delete. Empty string means a pure insertion at the position context_before + context_after meets.',
              },
              replace: {
                type: 'string',
                description:
                  'Replacement text. Empty string means pure deletion.',
              },
              context_before: {
                type: 'string',
                description:
                  '5–15 words from the document immediately before `find` (verbatim, including punctuation/spacing). Used to disambiguate identical `find` strings that occur multiple times.',
              },
              context_after: {
                type: 'string',
                description:
                  '5–15 words from the document immediately after `find` (verbatim). Used to disambiguate.',
              },
              reason: {
                type: 'string',
                description:
                  'Short rationale for the edit (e.g., "tighten confidentiality scope"). Surfaces in the per-edit result so the user can decide which proposals to accept.',
              },
            },
            required: ['find', 'replace', 'context_before', 'context_after'],
            additionalProperties: false,
          },
        },
      },
      required: ['file_id', 'edits'],
      additionalProperties: false,
    },
    async execute(
      args: {
        file_id: string;
        edits: Array<{
          find: string;
          replace: string;
          context_before: string;
          context_after: string;
          reason?: string;
        }>;
      },
      ctx: ToolContext,
    ) {
      const sessionId = ctx.sessionId;
      if (!sessionId) {
        return { error: 'tool requires ctx.sessionId; chat router did not propagate it' };
      }
      const source = opts.fileStore.get(sessionId, args.file_id);
      if (!source) {
        return { error: `file_id not found in session: ${args.file_id}` };
      }
      if (!isDocx(source)) {
        return {
          error: `propose_document_edits requires a .docx file (got ${source.mimeType}). Convert with convert_to_markdown first if you only need to read it, or upload a .docx.`,
        };
      }

      let result;
      try {
        result = proposeDocumentEdits({
          docxBytes: source.bytes,
          edits: args.edits,
          author: opts.author,
        });
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'propose_document_edits failed',
        };
      }

      const proposalId = generateProposalId();
      const proposalName = proposalFilename(source.name);
      opts.fileStore.put({
        id: proposalId,
        sessionId,
        name: proposalName,
        mimeType: DOCX_MIME,
        size: result.bytes.length,
        bytes: Buffer.from(result.bytes),
        createdAt: Date.now(),
      });

      let versionId: string | undefined;
      try {
        if (result.applied_count > 0) {
          const v = opts.versionsStore.addVersion({
            externalDocId: args.file_id,
            parentId: null,
            source: 'proposal',
            storageId: proposalId,
            byteSize: result.bytes.length,
            notes: `AI proposed ${result.applied_count} edit${result.applied_count === 1 ? '' : 's'}`,
          });
          versionId = v.id;
        }
      } catch (err) {
        console.warn(
          '[propose_document_edits] versionsStore.addVersion failed:',
          err instanceof Error ? err.message : err,
        );
      }

      const downloadUrl = opts.buildDownloadUrl(sessionId, proposalId);
      return {
        applied_count: result.applied_count,
        total: result.total,
        summary: result.summary,
        applied_edits: result.applied_edits,
        errors: result.errors,
        download_url: downloadUrl,
        download_session_id: sessionId,
        download_file_id: proposalId,
        download_filename: proposalName,
        version_id: versionId,
      };
    },
  };
}
