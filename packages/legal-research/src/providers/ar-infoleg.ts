// AR/InfoLEG — Argentina's official legislative database.
//
// Backend: HTML form at https://servicios.infoleg.gob.ar/infolegInternet/.
// No public API; we POST to buscarNormas.do and parse HTML for hits, then
// fetch text from /anexos/<range>/<id>/(texact|norma).htm.
//
// Quirks:
//   - The site responds in windows-1252 — must decode explicitly.
//   - Search form requires at least 2 of (norm_type, number, text, year);
//     if the user gave us only a free-text query, we expand it via heuristics
//     in `parseQuery` below.
//   - JSESSIONID cookie required for the POST to behave.

import {
  fetchText,
  stripHtml,
  truncateText,
  extractArticles,
  DEFAULT_MAX_TEXT_CHARS,
  DEFAULT_TIMEOUT_MS,
} from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  GetDocumentOpts,
  FullDocument,
  FindInDocumentOpts,
  FindInDocumentResult,
  SearchHit,
} from '../types.js';

const BASE = 'https://servicios.infoleg.gob.ar/infolegInternet';

const NORM_TYPE_LABELS: Record<string, string> = {
  '1': 'Ley',
  '2': 'Decreto',
  '3': 'Resolución',
  '4': 'Disposición',
  '7': 'Decreto/Ley',
  '8': 'Decisión Administrativa',
};

const NORM_TYPE_BY_LABEL: Record<string, string> = {
  ley: '1',
  decreto: '2',
  resolucion: '3',
  resolución: '3',
  disposicion: '4',
  disposición: '4',
  'decreto/ley': '7',
  'decreto-ley': '7',
  'decision administrativa': '8',
  'decisión administrativa': '8',
};

interface ParsedQuery {
  norm_type?: string;
  number?: string;
  year?: string;
  text?: string;
}

/** Pull norm_type / number / year hints out of a free-text query so InfoLEG accepts the search. */
function parseQuery(query: string): ParsedQuery {
  const out: ParsedQuery = {};
  const lower = query.toLowerCase();

  for (const [label, code] of Object.entries(NORM_TYPE_BY_LABEL)) {
    if (lower.includes(label)) {
      out.norm_type = code;
      break;
    }
  }

  // Number patterns: "Ley 19550", "Decreto 70/2023", "n° 19.550"
  const numMatch = query.match(/\b(?:n[°º\.]?\s*)?(\d{1,3}(?:\.?\d{3})+|\d{2,5})(?:\/(\d{2,4}))?\b/);
  if (numMatch) {
    out.number = numMatch[1].replace(/\./g, '');
    if (numMatch[2]) out.year = numMatch[2].length === 2 ? `20${numMatch[2]}` : numMatch[2];
  }

  // Standalone 4-digit year (1900-2099)
  if (!out.year) {
    const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) out.year = yearMatch[1];
  }

  // Whatever's left over goes to free-text
  out.text = query.trim();

  return out;
}

async function fetchInfoleg(url: string, init?: RequestInit): Promise<string> {
  return fetchText(url, { ...init, decoder: 'windows-1252' });
}

function extractSessionCookie(response: Response): string | undefined {
  const cookies = (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (cookies) {
    for (const c of cookies) {
      const match = c.match(/JSESSIONID=([^;]+)/);
      if (match) return match[1];
    }
  }
  const combined = response.headers.get('set-cookie') ?? '';
  return combined.match(/JSESSIONID=([^;]+)/)?.[1];
}

function parseSearchResults(html: string): { total: number; hits: SearchHit[] } {
  const hits: SearchHit[] = [];

  const totalMatch =
    html.match(/Se\s+encontraron\s+(\d+)\s+resultado/i) ?? html.match(/(\d+)\s+resultado/i);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  const blocks = html.split(/verNorma\.do\?id=/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const idMatch = block.match(/^(\d+)/);
    if (!idMatch) continue;
    const infoleg_id = idMatch[1];

    const typeNumMatch = block.match(
      /(Ley|Decreto|Resoluci[oó]n|Disposici[oó]n|Decisi[oó]n\s+Administrativa)\s+([\d\w/.]+)/i,
    );
    const norm_type = typeNumMatch?.[1] ?? '';
    const number = typeNumMatch?.[2] ?? '';

    const agencyMatch =
      block.match(/Organismo[^:]*:\s*([^<\n]+)/i) ?? block.match(/Emisor[^:]*:\s*([^<\n]+)/i);
    const agency = agencyMatch ? stripHtml(agencyMatch[1]).trim() : '';

    const dateMatch =
      block.match(/Fecha[^:]*:\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i) ??
      block.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{4})/);
    const date_published = dateMatch?.[1];

    let subject = '';
    let summary = '';
    const subjectMatch = block.match(/Sumario|Tema|Asunto/i);
    if (subjectMatch) {
      const after = block.slice(subjectMatch.index! + subjectMatch[0].length);
      const lines = stripHtml(after.slice(0, 1000)).split('\n').filter(Boolean);
      subject = lines[0]?.trim().slice(0, 300) ?? '';
      summary = lines.slice(1).join(' ').trim().slice(0, 500);
    } else {
      const lines = stripHtml(block.slice(0, 2000))
        .split('\n')
        .filter((l) => l.trim().length > 20);
      subject = lines[0]?.trim().slice(0, 300) ?? '';
      summary = lines.slice(1, 3).join(' ').trim().slice(0, 500);
    }

    hits.push({
      source_id: 'AR/InfoLEG',
      doc_id: infoleg_id,
      jurisdiction: 'AR',
      type: 'legislation',
      title: subject || `${norm_type} ${number}`.trim(),
      snippet: summary,
      date: date_published,
      url: `${BASE}/verNorma.do?id=${infoleg_id}`,
      metadata: { norm_type, number, agency },
    });
  }

  return { total, hits };
}

function textUrl(id: string, version: 'consolidated' | 'original'): string {
  const idNum = parseInt(id, 10);
  const rangeStart = Math.floor(idNum / 5000) * 5000;
  const rangeEnd = rangeStart + 4999;
  const file = version === 'consolidated' ? 'texact.htm' : 'norma.htm';
  return `${BASE}/anexos/${rangeStart}-${rangeEnd}/${idNum}/${file}`;
}

async function postSearch(parsed: ParsedQuery, page: number): Promise<{ total: number; hits: SearchHit[] }> {
  // Step 1: GET to obtain JSESSIONID
  const getResponse = await fetch(`${BASE}/buscarNormas.do`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  await getResponse.arrayBuffer();
  const sessionId = extractSessionCookie(getResponse);

  const formData = new URLSearchParams();
  if (parsed.norm_type) formData.set('tipoNorma', parsed.norm_type);
  if (parsed.number) formData.set('numero', parsed.number);
  if (parsed.text) formData.set('texto', parsed.text);
  if (parsed.year) formData.set('anioSancion', parsed.year);
  formData.set('offset', String((page - 1) * 10));

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (sessionId) headers['Cookie'] = `JSESSIONID=${sessionId}`;

  const html = await fetchInfoleg(`${BASE}/buscarNormas.do`, {
    method: 'POST',
    headers,
    body: formData.toString(),
  });
  return parseSearchResults(html);
}

export const arInfoleg: LegalProvider = {
  source_id: 'AR/InfoLEG',
  jurisdiction: 'AR',
  name: 'InfoLEG (Argentina)',
  data_types: ['legislation'],
  summary:
    'Argentina\'s official legislative database — leyes, decretos, resoluciones, disposiciones, decisiones administrativas. Best for federal legislation. Tip: include the norm number ("Ley 19550") or year for specific lookups.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'AR/InfoLEG', page: opts.page ?? 1, has_more: false, results: [], total: 0 };
    }
    const parsed = parseQuery(opts.query);
    // InfoLEG requires ≥2 criteria — count what we have
    const provided = [parsed.norm_type, parsed.number, parsed.text, parsed.year].filter(Boolean).length;
    if (provided < 2) {
      throw new Error(
        'InfoLEG search needs at least two of (norm_type, number, year, text). Add a year or norm number to the query.',
      );
    }
    const page = opts.page ?? 1;
    const { total, hits } = await postSearch(parsed, page);
    return {
      source_id: 'AR/InfoLEG',
      total,
      page,
      has_more: page * 10 < total,
      results: hits,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const version = (opts.version === 'original' ? 'original' : 'consolidated') as
      | 'original'
      | 'consolidated';
    const url = textUrl(opts.doc_id, version);

    let html: string;
    try {
      html = await fetchInfoleg(url);
    } catch (err) {
      if (version === 'consolidated') {
        html = await fetchInfoleg(textUrl(opts.doc_id, 'original'));
      } else {
        throw err;
      }
    }
    const plainText = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const shouldTruncate = opts.truncate !== false;
    const result = shouldTruncate ? truncateText(plainText, max) : { text: plainText, truncated: false, full_length_chars: plainText.length };

    return {
      source_id: 'AR/InfoLEG',
      doc_id: opts.doc_id,
      jurisdiction: 'AR',
      type: 'legislation',
      title: `InfoLEG ${opts.doc_id}`,
      text: result.text,
      url,
      full_length_chars: result.full_length_chars,
      truncated: result.truncated,
      version,
    };
  },

  async findInDocument(opts: FindInDocumentOpts): Promise<FindInDocumentResult> {
    const max = opts.max_articles ?? 5;
    let html: string;
    try {
      html = await fetchInfoleg(textUrl(opts.doc_id, 'consolidated'));
    } catch {
      html = await fetchInfoleg(textUrl(opts.doc_id, 'original'));
    }
    const plainText = stripHtml(html);
    const articles = extractArticles(plainText);
    const kw = opts.keyword.toLowerCase();
    const matches = articles.filter((a) => a.text.toLowerCase().includes(kw)).slice(0, max);
    return {
      source_id: 'AR/InfoLEG',
      doc_id: opts.doc_id,
      keyword: opts.keyword,
      matches,
      total_articles: articles.length,
      url: `${BASE}/verNorma.do?id=${opts.doc_id}`,
    };
  },
};

export { NORM_TYPE_LABELS };
