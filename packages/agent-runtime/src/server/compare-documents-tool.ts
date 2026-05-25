import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import type { DocumentDiffResult } from '@teamsuzie/docx-diff';
import type { InMemoryFileStore } from './files-route.js';
import { runDocumentDiff } from './run-document-diff.js';

/**
 * One row of the topic-based comparison. The CompareTable renders a
 * sticky topic header above the left/right cells per row.
 */
export interface CompareTopic {
  /** Short, human-readable topic name (e.g. "Excused Investments: From
   *  Japanese ESG to Canadian Pension Compliance"). */
  topic: string;
  /** Plain-English summary of what the LEFT document says about this
   *  topic, or "(absent)" / similar when the topic is only on the right. */
  left: string;
  /** Same for the RIGHT document. */
  right: string;
}

/**
 * Async summarizer called by the tool after the mechanical diff. Given
 * the raw markdown diff and the filenames, returns topic-grouped rows.
 * Provided by the host (createApp wires it to the manifest's simpleModel).
 * Should return null when no summarizer is configured / synthesis
 * failed — the tool falls back to returning mechanical events only,
 * and the table renders the paragraph-by-paragraph view.
 */
export type CompareSummarizer = (input: {
  leftName: string;
  rightName: string;
  diffMarkdown: string;
}) => Promise<CompareTopic[] | null>;

export interface BuildCompareDocumentsToolOptions {
  /** Active session id for this turn. */
  sessionId: string;
  fileStore: InMemoryFileStore;
  /** markitdown-agent base URL for non-DOCX paragraph extraction. Empty
   *  string means non-DOCX comparisons error out. */
  markitdownBaseUrl: string;
  /** Optional LLM-backed summarizer that turns the mechanical diff into
   *  topic-grouped rows. When omitted or returning null, the tool falls
   *  back to the mechanical event stream — the CompareTable then renders
   *  one row per paragraph diff event instead of one row per topic. */
  summarize?: CompareSummarizer;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * `compare_documents(left, right)` — analytical paragraph-by-paragraph
 * comparison between two uploaded files. Returns the full
 * `DocumentDiffResult` (stats + per-paragraph event stream) plus a
 * markdown summary the model can quote inline.
 *
 * Sister tool to `blackline_documents`: compare = "show me a structured
 * analysis of what changed"; blackline = "give me the diff as a Word
 * file". Both run the same underlying diff engine
 * (`runDocumentDiff`) so their outputs always agree. The model may call
 * one, the other, or both depending on what the user asked for.
 *
 * The chat client renders the events as a two-column `<CompareTable>`
 * in the side panel — left filename / right filename header, one row
 * per modified/deleted/inserted paragraph with word-level diff inline.
 */
export function buildCompareDocumentsTool(
  opts: BuildCompareDocumentsToolOptions,
): AnyToolDefinition {
  const { sessionId, fileStore, markitdownBaseUrl, summarize, fetchImpl } = opts;

  return {
    name: 'compare_documents',
    description:
      'Analyze two previously-uploaded documents and produce a topic-based comparison: substantive changes grouped by subject (not paragraph-by-paragraph), with a plain-English summary of what each side says. **Call this when the user asks "what\'s different", "how do these compare", "summarize the changes", "diff these versions" — i.e., wants to UNDERSTAND the substantive differences.** For a downloadable Word `.docx` with tracked changes (the literal "blackline"), use `blackline_documents` instead — the two are sister tools and may both be called for the same pair. The result is rendered in the client as a two-column comparison table, one row per topic. Use the `markdown` field if you want to quote the textual summary inline in your reply.',
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
      const diffMarkdown = renderDiffMarkdown(diff);

      // Topic synthesis (LLM-backed). Best-effort: if no summarizer is
      // configured or it fails, we return events only and the table
      // renders the paragraph-by-paragraph view as a fallback.
      let topics: CompareTopic[] | undefined;
      if (summarize) {
        try {
          const result = await summarize({
            leftName: left.name,
            rightName: right.name,
            diffMarkdown,
          });
          if (result && result.length > 0) topics = result;
        } catch (err) {
          console.warn(
            '[compare_documents] topic synthesis failed, falling back to events:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      return {
        left: diff.left,
        right: diff.right,
        stats: diff.stats,
        summary: formatStatsLine(diff),
        markdown: diffMarkdown,
        // File ids echoed back so the client can subscribe to the
        // /api/documents/compare/summary SSE stream without having to
        // track the original tool_call args.
        left_file_id: args.left_file_id,
        right_file_id: args.right_file_id,
        // Topic-based comparison (preferred render path). When absent
        // the client falls back to rendering one row per event.
        topics,
        // Full event stream — fallback render when no topics, and useful
        // for the model to reference specific paragraphs if needed.
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
