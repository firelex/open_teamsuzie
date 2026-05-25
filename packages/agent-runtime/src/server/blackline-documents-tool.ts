import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { composeRedline, redlineDownloadFilename } from '@teamsuzie/docx';
import type { DocumentDiffResult } from '@teamsuzie/docx-diff';
import type { FileRecord, InMemoryFileStore } from './files-route.js';
import { runDocumentDiff } from './run-document-diff.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface BuildBlacklineDocumentsToolOptions {
  /** Active session id for this turn. */
  sessionId: string;
  fileStore: InMemoryFileStore;
  /** markitdown-agent base URL for non-DOCX paragraph extraction. Empty
   *  string means non-DOCX blacklines error out. */
  markitdownBaseUrl: string;
  /** Author stamped on tracked changes in the redline DOCX. */
  author?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * `blackline_documents(left, right)` — produces a literal tracked-change
 * `.docx` (the "blackline") between two uploaded files. Returns the
 * download_url plus the markdown report and stats for the model to
 * summarise.
 *
 * Sister tool to `compare_documents`: blackline = "give me the diff as a
 * Word file"; compare = "show me a structured analysis of what changed".
 * Both run the same underlying diff engine (`runDocumentDiff`) so their
 * outputs always agree. The model may call one, the other, or both
 * depending on what the user asked for.
 *
 * Ported from suzielaw's `tools/diff.ts`.
 */
export function buildBlacklineDocumentsTool(
  opts: BuildBlacklineDocumentsToolOptions,
): AnyToolDefinition {
  const {
    sessionId, fileStore, markitdownBaseUrl,
    author = 'AI assistant', fetchImpl,
  } = opts;

  return {
    name: 'blackline_documents',
    description:
      'Produce a literal blackline (Word `.docx` with tracked changes) between two previously-uploaded documents. **Call this when the user asks for a "blackline", a "redline", a "tracked-changes file", or wants the literal word-by-word diff as a downloadable Word file.** For an analytical side-by-side view of what changed (without a downloadable file), use `compare_documents` instead — the two are sister tools and may both be called for the same pair if the user wants both. Returns a `download_url` to a `.docx` where accept-all in Word reproduces the right document and reject-all reproduces the left. NEVER fabricate a download URL; the only valid one is the one returned here. Include the `download_url` verbatim as a clickable link in your reply.',
    parameters: {
      type: 'object',
      properties: {
        left_file_id: {
          type: 'string',
          description:
            "The earlier / 'before' / 'v1' document's file_id from the [Attachments] block.",
        },
        right_file_id: {
          type: 'string',
          description:
            "The later / 'after' / 'v2' document's file_id from the [Attachments] block.",
        },
      },
      required: ['left_file_id', 'right_file_id'],
      additionalProperties: false,
    },
    async execute(args: { left_file_id: string; right_file_id: string }) {
      const left = fileStore.get(sessionId, args.left_file_id);
      if (!left) {
        throw new Error(`left_file_id not found in session: ${args.left_file_id}`);
      }
      const right = fileStore.get(sessionId, args.right_file_id);
      if (!right) {
        throw new Error(`right_file_id not found in session: ${args.right_file_id}`);
      }
      if (left.id === right.id) {
        throw new Error('left_file_id and right_file_id must reference different files.');
      }

      const diff = await runDocumentDiff(left, right, { markitdownBaseUrl, fetchImpl });

      // Best-effort redline DOCX. Failure here returns the markdown
      // report only — the model can still talk about the differences.
      let downloadUrl: string | null = null;
      let downloadFileId: string | null = null;
      let downloadFilename: string | null = null;
      try {
        const redlineBytes = composeRedline({
          leftBytes: left.bytes,
          rightBytes: right.bytes,
          diff,
          author,
        });
        const filename = redlineDownloadFilename(left.name, right.name);
        const fileId = `file_redline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        const record: FileRecord = {
          id: fileId,
          sessionId,
          name: filename,
          mimeType: DOCX_MIME,
          size: redlineBytes.length,
          bytes: redlineBytes,
          createdAt: Date.now(),
        };
        fileStore.put(record);
        downloadFileId = fileId;
        downloadFilename = filename;
        downloadUrl = `/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/content`;
      } catch (err) {
        console.warn(
          '[compare_documents] redline export failed, returning markdown only:',
          err instanceof Error ? err.message : err,
        );
      }

      return {
        left: diff.left,
        right: diff.right,
        stats: diff.stats,
        summary: formatStatsLine(diff),
        markdown: renderDiffMarkdown(diff),
        download_url: downloadUrl,
        download_file_id: downloadFileId,
        download_filename: downloadFilename,
        // Full paragraph-diff event stream. The model already has the
        // markdown summary so it rarely needs this; the chat client uses
        // it to reconstruct a DocumentDiffResult and render the upstream
        // <VersionDiff> artifact in the side panel.
        events: diff.events,
      };
    },
  };
}

function formatStatsLine(diff: DocumentDiffResult): string {
  const { unchanged, modified, deleted, inserted, moved } = diff.stats;
  const parts: string[] = [];
  if (modified) parts.push(`${modified} modified`);
  if (deleted) parts.push(`${deleted} deleted from left`);
  if (inserted) parts.push(`${inserted} inserted into right`);
  if (moved) parts.push(`${moved} moved`);
  parts.push(`${unchanged} unchanged`);
  return parts.join(' · ');
}

function renderDiffMarkdown(diff: DocumentDiffResult): string {
  const lines: string[] = [];
  lines.push(`## Comparing **${diff.left.name}** → **${diff.right.name}**`);
  lines.push('');
  lines.push(`_${formatStatsLine(diff)}_`);
  lines.push('');

  let emittedAny = false;
  for (const event of diff.events) {
    if (event.kind === 'unchanged') continue;
    emittedAny = true;
    if (event.kind === 'modified') {
      const inline = renderModifiedInline(event.ops);
      const tag = event.moved ? 'modified + moved' : 'modified';
      lines.push(
        `**¶${event.leftIndex + 1} → ¶${event.rightIndex + 1}** _(${tag}, ${Math.round(event.similarity * 100)}% match)_`,
      );
      lines.push('');
      lines.push(blockquote(inline));
      lines.push('');
    } else if (event.kind === 'deleted') {
      lines.push(`**¶${event.leftIndex + 1} of left** _(deleted)_`);
      lines.push('');
      lines.push(blockquoteWithMarker(event.text, '~~'));
      lines.push('');
    } else {
      lines.push(`**¶${event.rightIndex + 1} of right** _(inserted)_`);
      lines.push('');
      lines.push(blockquoteWithMarker(event.text, '**'));
      lines.push('');
    }
  }

  if (!emittedAny) {
    lines.push('_The two documents are identical._');
  }
  return lines.join('\n');
}

interface WordDiffOpLike {
  kind: 'equal' | 'insert' | 'delete';
  text: string;
}

function renderModifiedInline(ops: WordDiffOpLike[]): string {
  let out = '';
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.kind === 'equal') {
      out += op.text;
      continue;
    }
    const trimmed = op.text.trim();
    if (!trimmed) continue;
    const leading = op.text.match(/^\s*/)?.[0] ?? '';
    const trailing = op.text.match(/\s*$/)?.[0] ?? '';
    const marker = op.kind === 'delete' ? '~~' : '**';
    const prev = i > 0 ? ops[i - 1] : null;
    const isSwap = prev?.kind === 'delete' && op.kind === 'insert';
    const sep = isSwap ? (/\s$/.test(out) ? '→ ' : ' → ') : '';
    out += `${sep}${leading}${marker}${trimmed}${marker}${trailing}`;
  }
  return out;
}

function wrapTight(text: string, marker: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  return `${leading}${marker}${trimmed}${marker}${trailing}`;
}

function blockquoteWithMarker(text: string, marker: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `> ${wrapTight(line, marker)}` : '>'))
    .join('\n');
}

function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}
