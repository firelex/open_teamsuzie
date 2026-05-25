// Shared helpers for legal-research providers.

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TEXT_CHARS = 20_000;

export class ProviderError extends Error {
  constructor(message: string, public readonly source_id: string, public readonly cause_status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

export async function fetchText(url: string, init?: RequestInit & { decoder?: string }): Promise<string> {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`), {
      status: response.status,
    });
  }
  if (init?.decoder && init.decoder !== 'utf-8') {
    const buf = await response.arrayBuffer();
    return new TextDecoder(init.decoder).decode(buf);
  }
  return await response.text();
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`), {
      status: response.status,
    });
  }
  return (await response.json()) as T;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncateText(
  text: string,
  max: number,
): { text: string; truncated: boolean; full_length_chars: number } {
  const full = text.length;
  if (full <= max) return { text, truncated: false, full_length_chars: full };
  return {
    text: text.slice(0, max) + `\n\n[...truncated; original length ${full} chars]`,
    truncated: true,
    full_length_chars: full,
  };
}

/**
 * Multi-file zip reader. Walks Local File Headers, returns each entry's
 * filename + decompressed body. Stops at the central directory signature.
 * Sufficient for EPUB and small archives without using a dep.
 */
export function readZipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  // Lazy require so the helper stays tree-shakable for callers that don't use it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const out: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x02014b50) break; // central directory — done
    if (sig !== 0x04034b50) break; // unknown — bail
    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const fileNameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + fileNameLen + extraLen;
    const name = buf.subarray(offset + 30, offset + 30 + fileNameLen).toString('utf8');
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (compressionMethod === 0) data = compressed;
    else if (compressionMethod === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported zip compression ${compressionMethod} for ${name}`);
    out.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return out;
}

/** Generic article splitter — works for codes that use "Article 12" / "Art. 12" markers. */
export function extractArticles(plainText: string): { article_number: string; text: string }[] {
  const pattern = /\b(ART[IÍ]CULO|ARTICLE|ART\.?)\s+(\d+[°º]?\s*(?:bis|ter|qu[aá]ter|quinquies)?(?:[-–]\d+)?)\s*[-–—.:]/gi;
  const out: { article_number: string; text: string }[] = [];
  const matches: { index: number; number: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(plainText)) !== null) {
    matches.push({ index: m.index, number: m[2].replace(/[°º\s]/g, '').trim() });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : plainText.length;
    out.push({ article_number: matches[i].number, text: plainText.slice(start, end).trim() });
  }
  return out;
}
