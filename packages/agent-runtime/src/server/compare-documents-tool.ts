import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { composeRedline, redlineDownloadFilename } from '@teamsuzie/docx';
import type { DocumentDiffResult } from '@teamsuzie/docx-diff';
import type { FileRecord, InMemoryFileStore } from './files-route.js';
import { runDocumentDiff } from './run-document-diff.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface BuildCompareDocumentsToolOptions {
  /** Active session id for this turn. */
  sessionId: string;
  fileStore: InMemoryFileStore;
  /** markitdown-agent base URL for non-DOCX paragraph extraction. Empty
   *  string means non-DOCX comparisons error out. */
  markitdownBaseUrl: string;
  /** Author stamped on tracked changes when the redline DOCX is written. */
  author?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * `compare_documents(left, right)` — paragraph-by-paragraph diff between
 * two uploaded files. Returns a markdown report (with `~~deletions~~` and
 * `**insertions**` inline) plus a tracked-change `.docx` the user can
 * download (accept-all reproduces right, reject-all reproduces left).
 *
 * Ported from suzielaw's `tools/diff.ts`. The diff engine itself is in
 * `run-document-diff.ts` (also ported, since suzielaw colocates it).
 */
export function buildCompareDocumentsTool(
  opts: BuildCompareDocumentsToolOptions,
): AnyToolDefinition {
  const {
    sessionId, fileStore, markitdownBaseUrl,
    author = 'AI assistant', fetchImpl,
  } = opts;

  return {
    name: 'compare_documents',
    description:
      'Compare two previously-uploaded documents (DOCX/PDF/etc.) paragraph-by-paragraph and return a redline-style diff PLUS a downloadable tracked-change `.docx`. **Call this tool whenever the user asks for any of: "compare", "diff", "redline", "blackline", "show changes", "what changed", "differences", or any synonym referring to a side-by-side / version comparison between two attached documents.** Do NOT describe the comparison only in prose when this tool is available — invoking it is the only way to produce a real downloadable file. NEVER fabricate a download URL; the only valid `download_url` is the one returned in this tool\'s result. The result has (a) `stats` + `summary`, (b) a `markdown` field with `~~deletions~~` and `**insertions**` inline you can quote back, and (c) a `download_url` pointing at a tracked-change `.docx` (accept-all reproduces the right document; reject-all reproduces the left). Include the `download_url` verbatim as a clickable link in your reply.',
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
