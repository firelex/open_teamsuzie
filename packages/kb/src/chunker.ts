/**
 * Chunk markdown text into overlapping pieces sized for embedding. Tries to
 * break on paragraph and sentence boundaries before falling back to hard
 * character splits, so chunks read coherently when surfaced as RAG hits.
 *
 * Sizes are character-based (not token-based) to avoid pulling in a
 * tokenizer dependency. Rough rule: ~4 characters per token, so the default
 * 3200-char target ≈ 800 tokens, well under most embedding-model limits.
 */
export interface ChunkerOptions {
  /** Target chunk size in characters. */
  targetSize?: number;
  /** Overlap between consecutive chunks, in characters. */
  overlap?: number;
  /** Hard maximum — chunks that exceed this get split mid-paragraph. */
  maxSize?: number;
}

export interface Chunk {
  content: string;
  startChar: number;
  endChar: number;
}

const DEFAULT_TARGET = 3200;
const DEFAULT_OVERLAP = 400;
const DEFAULT_MAX = 4800;

export function chunkMarkdown(text: string, options: ChunkerOptions = {}): Chunk[] {
  const targetSize = options.targetSize ?? DEFAULT_TARGET;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const maxSize = options.maxSize ?? DEFAULT_MAX;

  if (!text.trim()) return [];

  // Split on paragraph boundaries first.
  const paragraphs = splitWithOffsets(text, /\n\s*\n/);
  const chunks: Chunk[] = [];
  let current = '';
  let currentStart = paragraphs[0]?.start ?? 0;
  let currentEnd = currentStart;

  const flush = () => {
    if (current.trim()) {
      chunks.push({ content: current.trim(), startChar: currentStart, endChar: currentEnd });
    }
  };

  for (const para of paragraphs) {
    // If adding this paragraph would exceed maxSize, flush first.
    if (current && current.length + para.text.length + 2 > maxSize) {
      flush();
      // Start the next chunk with `overlap` chars from the end of the
      // previous chunk for continuity.
      const tail = takeTail(current, overlap);
      current = tail ? tail + '\n\n' + para.text : para.text;
      currentStart = tail ? currentEnd - tail.length : para.start;
      currentEnd = para.end;
      continue;
    }

    if (!current) {
      current = para.text;
      currentStart = para.start;
      currentEnd = para.end;
    } else {
      current = current + '\n\n' + para.text;
      currentEnd = para.end;
    }

    if (current.length >= targetSize) {
      flush();
      const tail = takeTail(current, overlap);
      current = tail;
      currentStart = currentEnd - tail.length;
    }
  }

  flush();

  // Final pass: if any single paragraph was so long that the chunk is still
  // > maxSize, do a hard split at sentence boundaries (or characters).
  return chunks.flatMap((c) => (c.content.length <= maxSize ? [c] : hardSplit(c, targetSize, overlap)));
}

function splitWithOffsets(text: string, pattern: RegExp): { text: string; start: number; end: number }[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const out: { text: string; start: number; end: number }[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      out.push({ text: text.slice(last, match.index), start: last, end: match.index });
    }
    last = re.lastIndex;
    if (match.index === re.lastIndex) re.lastIndex++; // zero-width safety
  }
  if (last < text.length) {
    out.push({ text: text.slice(last), start: last, end: text.length });
  }
  return out.filter((p) => p.text.trim());
}

function takeTail(text: string, n: number): string {
  if (text.length <= n) return text;
  // Try to break at a sentence/word boundary near the cut.
  const slice = text.slice(text.length - n);
  const sentenceBreak = slice.search(/[.!?]\s/);
  if (sentenceBreak > 0 && sentenceBreak < n / 2) {
    return slice.slice(sentenceBreak + 2);
  }
  const wordBreak = slice.indexOf(' ');
  if (wordBreak > 0 && wordBreak < n / 4) {
    return slice.slice(wordBreak + 1);
  }
  return slice;
}

function hardSplit(chunk: Chunk, target: number, overlap: number): Chunk[] {
  const out: Chunk[] = [];
  let pos = 0;
  while (pos < chunk.content.length) {
    const end = Math.min(pos + target, chunk.content.length);
    const sub = chunk.content.slice(pos, end);
    out.push({
      content: sub,
      startChar: chunk.startChar + pos,
      endChar: chunk.startChar + end,
    });
    if (end === chunk.content.length) break;
    pos = Math.max(0, end - overlap);
  }
  return out;
}
