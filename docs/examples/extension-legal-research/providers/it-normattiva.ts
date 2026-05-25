// IT/Normattiva — Italian consolidated legislation.
//
// Normattiva has no public API; we hit the public search frontend and
// parse HTML for codice-redazionale ids, then fetch full text via the
// ELI permalink scheme.

import { fetchText, stripHtml, truncateText, extractArticles, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
  FindInDocumentOpts,
  FindInDocumentResult,
} from '../types.js';

const SEARCH_URL = 'https://www.normattiva.it/ricerca/semplice';
const URI_RES = 'https://www.normattiva.it/uri-res/N2Ls';
const ELI_BASE = 'https://www.normattiva.it/eli/id';

interface ParsedHit {
  uri?: string;
  codice?: string;
  title: string;
  date?: string;
}

function parseSearchHtml(html: string): ParsedHit[] {
  const out: ParsedHit[] = [];
  const seen = new Set<string>();
  // Look for ELI permalinks in the result list:
  //   /eli/id/2018/05/25/18G00088/sg
  //   /eli/id/YYYY/MM/DD/<codice>/sg
  const pattern = /\/eli\/id\/(\d{4})\/(\d{2})\/(\d{2})\/([A-Z0-9]+)\/sg/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const codice = m[4];
    if (seen.has(codice)) continue;
    seen.add(codice);
    // Try to grab a nearby title — peek ~300 chars after the link
    const after = html.slice(m.index, m.index + 600);
    const titleMatch = after.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).slice(0, 300) : codice;
    out.push({
      uri: `/eli/id/${m[1]}/${m[2]}/${m[3]}/${codice}/sg`,
      codice,
      date: `${m[1]}-${m[2]}-${m[3]}`,
      title,
    });
    if (out.length >= 15) break;
  }
  return out;
}

export const itNormattiva: LegalProvider = {
  source_id: 'IT/Normattiva',
  jurisdiction: 'IT',
  name: 'Normattiva (Italy)',
  data_types: ['legislation'],
  summary:
    'Italian consolidated legislation. Documents identified by codice redazionale + ELI permalink. Best for finding leggi, decreti legislativi, decreti-legge by keyword.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'IT/Normattiva', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const params = new URLSearchParams({
      formType: 'ricercaSemplice',
      stem: 'true',
      searchTerms: opts.query,
      // result page
      pagina: String(page),
    });
    const html = await fetchText(`${SEARCH_URL}?${params.toString()}`, {
      headers: { 'Accept-Language': 'it,en;q=0.9' },
    });
    const parsed = parseSearchHtml(html);
    const results: SearchHit[] = parsed.map((p) => ({
      source_id: 'IT/Normattiva',
      doc_id: p.uri ?? p.codice ?? '',
      jurisdiction: 'IT',
      type: 'legislation',
      title: p.title,
      date: p.date,
      url: `https://www.normattiva.it${p.uri}`,
      metadata: { codice_redazionale: p.codice },
    }));
    return {
      source_id: 'IT/Normattiva',
      page,
      has_more: results.length >= 10,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // doc_id is expected to be the ELI path "/eli/id/YYYY/MM/DD/<codice>/sg".
    // Add /CONSOLIDATED for the consolidated full text.
    const path = opts.doc_id.startsWith('/eli/') ? opts.doc_id : `/eli/id/${opts.doc_id}`;
    const consolidatedUrl = `https://www.normattiva.it${path.replace(/\/sg$/, '')}/CONSOLIDATED`;
    let html: string;
    try {
      html = await fetchText(consolidatedUrl);
    } catch {
      html = await fetchText(`https://www.normattiva.it${path}`);
    }
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'IT/Normattiva',
      doc_id: opts.doc_id,
      jurisdiction: 'IT',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      url: consolidatedUrl,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
    };
  },

  async findInDocument(opts: FindInDocumentOpts): Promise<FindInDocumentResult> {
    const max = opts.max_articles ?? 5;
    const path = opts.doc_id.startsWith('/eli/') ? opts.doc_id : `/eli/id/${opts.doc_id}`;
    const url = `https://www.normattiva.it${path.replace(/\/sg$/, '')}/CONSOLIDATED`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const articles = extractArticles(text);
    const kw = opts.keyword.toLowerCase();
    const matches = articles.filter((a) => a.text.toLowerCase().includes(kw)).slice(0, max);
    return {
      source_id: 'IT/Normattiva',
      doc_id: opts.doc_id,
      keyword: opts.keyword,
      matches,
      total_articles: articles.length,
      url,
    };
  },
};

void URI_RES;
void ELI_BASE;
