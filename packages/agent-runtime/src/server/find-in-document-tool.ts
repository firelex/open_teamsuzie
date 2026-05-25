import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { bodyParagraphTexts, loadDocx } from '@teamsuzie/docx';
import type { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import type { InMemoryFileStore } from './files-route.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MAX_MATCHES = 50;
const SNIPPET_PAD = 40;

interface FindMatch {
  /** 1-based paragraph index for DOCX; 1-based line index for markdown. */
  position: number;
  /** Short snippet (~80 chars centered on the match) for the model to quote. */
  snippet: string;
  /** Heading-path context for markdown documents, undefined otherwise. */
  heading_path?: string;
}

export interface BuildFindInDocumentToolOptions {
  /** Active session id for this turn — closed over by the tool. */
  sessionId: string;
  fileStore: InMemoryFileStore;
  /** Document store (markdown view of converted binaries). */
  docStore: InMemoryDocumentStore;
}

/**
 * `find_in_document(file_id, query)` — verbatim phrase search inside ONE
 * uploaded file. Returns position + snippet so the model can verify a
 * quote before citing it, or jump the user to the right paragraph.
 *
 * For DOCX, the position is the body-paragraph index (matches what
 * `read_section` and the redline view use, so a `find` result can anchor
 * a subsequent edit without re-locating). For converted markdown
 * documents, the position is the markdown line index plus the
 * containing heading path so the model can ground a citation in the
 * right section.
 *
 * Ported from suzielaw's `tools/find-in-document.ts`. Complements but
 * does not replace `search_document` from `documentNavigationTools` —
 * `search_document` requires markdown (model must convert first);
 * `find_in_document` reads DOCX directly.
 */
export function buildFindInDocumentTool(
  opts: BuildFindInDocumentToolOptions,
): AnyToolDefinition {
  const { sessionId, fileStore, docStore } = opts;
  return {
    name: 'find_in_document',
    description:
      "Search a SINGLE previously-uploaded document for a phrase. Returns the position (paragraph index for DOCX, line+heading for converted markdown) and a short snippet of each match. Use this to verify a quote before citing it, or to locate the right section before reading a longer span. For non-DOCX files, call `convert_to_markdown` first; this tool will then search the converted view. Case-insensitive substring match; pass `case_sensitive: true` for exact matching.",
    parameters: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description:
            'File id from the [Attachments] block. DOCX files are searched directly; other types must be converted first via `convert_to_markdown`.',
        },
        query: {
          type: 'string',
          description:
            'Phrase to search for. Searched as a substring (no regex), normalized for smart quotes / dashes / non-breaking spaces.',
        },
        case_sensitive: {
          type: 'boolean',
          description:
            'When true, the search is case-sensitive. Defaults to false.',
        },
      },
      required: ['file_id', 'query'],
      additionalProperties: false,
    },
    async execute(args: {
      file_id: string;
      query: string;
      case_sensitive?: boolean;
    }) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('query is required');
      const caseSensitive = args.case_sensitive === true;

      const record = fileStore.get(sessionId, args.file_id);
      if (!record) {
        throw new Error(`file_id not found in session: ${args.file_id}`);
      }

      const isDocx =
        record.name.toLowerCase().endsWith('.docx') ||
        record.mimeType === DOCX_MIME;

      if (isDocx) {
        const file = loadDocx(record.bytes);
        const paragraphs = bodyParagraphTexts(file);
        return findInParagraphs(paragraphs, query, caseSensitive, record.name);
      }

      // Non-DOCX: rely on the doc store. The convert_to_markdown tool
      // populates this store; if the model hasn't called it yet, surface
      // a structured error so the model retries with conversion first.
      const summaries = docStore.list(sessionId);
      const summary = summaries.find((d) => d.title === record.name);
      const doc = summary ? docStore.get(sessionId, summary.id) : null;
      if (!doc) {
        return {
          file_id: args.file_id,
          file_name: record.name,
          matches: [],
          error:
            'document_not_converted: call `convert_to_markdown` on this file_id first, then retry find_in_document.',
        };
      }
      return findInMarkdown(doc.getMarkdown(), query, caseSensitive, record.name);
    },
  };
}

function normalize(s: string, caseSensitive: boolean): string {
  const folded = s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/​/g, '');
  return caseSensitive ? folded : folded.toLowerCase();
}

function findInParagraphs(
  paragraphs: string[],
  query: string,
  caseSensitive: boolean,
  fileName: string,
): {
  file_name: string;
  total_matches: number;
  truncated: boolean;
  matches: FindMatch[];
} {
  const normQuery = normalize(query, caseSensitive);
  const matches: FindMatch[] = [];
  let total = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i];
    const normPara = normalize(text, caseSensitive);
    let from = 0;
    while (true) {
      const idx = normPara.indexOf(normQuery, from);
      if (idx === -1) break;
      total++;
      if (matches.length < MAX_MATCHES) {
        matches.push({
          position: i + 1,
          snippet: snippetAround(text, idx, normQuery.length),
        });
      }
      from = idx + Math.max(1, normQuery.length);
    }
  }
  return {
    file_name: fileName,
    total_matches: total,
    truncated: total > matches.length,
    matches,
  };
}

function findInMarkdown(
  markdown: string,
  query: string,
  caseSensitive: boolean,
  fileName: string,
): {
  file_name: string;
  total_matches: number;
  truncated: boolean;
  matches: FindMatch[];
} {
  const normQuery = normalize(query, caseSensitive);
  const lines = markdown.split('\n');
  const headingPathByLine = computeHeadingPaths(lines);
  const matches: FindMatch[] = [];
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normLine = normalize(line, caseSensitive);
    let from = 0;
    while (true) {
      const idx = normLine.indexOf(normQuery, from);
      if (idx === -1) break;
      total++;
      if (matches.length < MAX_MATCHES) {
        const m: FindMatch = {
          position: i + 1,
          snippet: snippetAround(line, idx, normQuery.length),
        };
        const path = headingPathByLine[i];
        if (path) m.heading_path = path;
        matches.push(m);
      }
      from = idx + Math.max(1, normQuery.length);
    }
  }
  return {
    file_name: fileName,
    total_matches: total,
    truncated: total > matches.length,
    matches,
  };
}

function snippetAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - SNIPPET_PAD);
  const end = Math.min(text.length, idx + len + SNIPPET_PAD);
  let s = text.slice(start, end);
  if (start > 0) s = '…' + s;
  if (end < text.length) s = s + '…';
  return s.replace(/\s+/g, ' ').trim();
}

function computeHeadingPaths(lines: string[]): Array<string | null> {
  const out: Array<string | null> = [];
  const stack: string[] = [];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const depth = m[1].length;
      const title = m[2].trim();
      stack.length = depth - 1;
      stack[depth - 1] = title;
      out.push(stack.filter(Boolean).join(' › '));
    } else {
      out.push(stack.length > 0 ? stack.filter(Boolean).join(' › ') : null);
    }
  }
  return out;
}
