// ES/BOE — Boletín Oficial del Estado (Spain), consolidated legislation.
//
// BOE's open-data API (datosabiertos) is date-window based, not free-text.
// For a runtime keyword search we use BOE's public legislation search
// frontend (HTML) and parse out BOE-A-YYYY-NNNNN identifiers, then fetch
// full texts via the open-data XML endpoint.

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

const SEARCH_BASE = 'https://www.boe.es/buscar/legislacion.php';
const TXT_BASE = 'https://www.boe.es/buscar/act.php?id=';
const XML_BASE = 'https://www.boe.es/diario_boe/xml.php?id=';

function parseSearchHtml(html: string): { hits: SearchHit[]; total?: number } {
  const hits: SearchHit[] = [];
  // BOE-A-YYYY-NNNNN IDs link to /buscar/act.php?id=BOE-A-...
  const seen = new Set<string>();
  const blockRegex = /<li[^>]*class="[^"]*resultado[^"]*"[\s\S]*?<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[0];
    const idMatch = block.match(/BOE-A-(\d{4})-(\d+)/);
    if (!idMatch) continue;
    const id = `BOE-A-${idMatch[1]}-${idMatch[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) ?? block.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).slice(0, 300) : id;
    const summaryMatch = block.match(/<p[^>]*class="[^"]*sumario[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = summaryMatch ? stripHtml(summaryMatch[1]).slice(0, 500) : undefined;
    hits.push({
      source_id: 'ES/BOE',
      doc_id: id,
      jurisdiction: 'ES',
      type: 'legislation',
      title,
      snippet,
      url: `${TXT_BASE}${id}`,
      metadata: { boe_id: id, year: idMatch[1] },
    });
  }
  // Fallback: look for raw BOE-A- links if the structured layout missed them
  if (hits.length === 0) {
    const linkRegex = /id=(BOE-A-\d{4}-\d+)/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRegex.exec(html)) !== null) {
      const id = lm[1];
      if (seen.has(id)) continue;
      seen.add(id);
      hits.push({
        source_id: 'ES/BOE',
        doc_id: id,
        jurisdiction: 'ES',
        type: 'legislation',
        title: id,
        url: `${TXT_BASE}${id}`,
        metadata: { boe_id: id },
      });
      if (hits.length >= 15) break;
    }
  }
  return { hits };
}

export const esBoe: LegalProvider = {
  source_id: 'ES/BOE',
  jurisdiction: 'ES',
  name: 'BOE (Spain — Boletín Oficial del Estado)',
  data_types: ['legislation'],
  summary:
    'Spain\'s Boletín Oficial del Estado — laws, royal decrees, ministerial orders, etc. Documents identified as BOE-A-YYYY-NNNNN. Best for legislation search by title keywords.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'ES/BOE', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    // BOE's basic legislation search uses these form-field names (verified
    // against the live form). campo[2]/dato[2] is the free-text search;
    // checkbox_solo_tit limits to title hits. Sort and page params can be
    // present in the form but interact badly with the simple search route —
    // omit them here.
    const params = new URLSearchParams({
      'campo[0]': 'ID_SRC',
      'dato[0]': '',
      'campo[2]': 'DOC',
      'dato[2]': opts.query,
      checkbox_solo_tit: 'S',
      accion: 'Buscar',
    });
    void page;
    const html = await fetchText(`${SEARCH_BASE}?${params.toString()}`, {
      headers: { 'Accept-Language': 'es,en;q=0.9' },
    });
    const { hits } = parseSearchHtml(html);
    return {
      source_id: 'ES/BOE',
      page,
      has_more: hits.length >= 10,
      results: hits.slice(0, 10),
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // The /act.php endpoint renders the consolidated text as HTML.
    const url = `${TXT_BASE}${opts.doc_id}`;
    const html = await fetchText(url);
    // The BOE XML alternative gives cleaner text — try it as a backup if HTML
    // strip yields too little. Here we just go with the HTML render.
    let text = stripHtml(html);
    if (text.length < 200) {
      try {
        const xml = await fetchText(`${XML_BASE}${opts.doc_id}`);
        text = stripHtml(xml);
      } catch {
        /* keep HTML */
      }
    }
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'ES/BOE',
      doc_id: opts.doc_id,
      jurisdiction: 'ES',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
    };
  },

  async findInDocument(opts: FindInDocumentOpts): Promise<FindInDocumentResult> {
    const max = opts.max_articles ?? 5;
    const html = await fetchText(`${TXT_BASE}${opts.doc_id}`);
    const text = stripHtml(html);
    const articles = extractArticles(text);
    const kw = opts.keyword.toLowerCase();
    const matches = articles.filter((a) => a.text.toLowerCase().includes(kw)).slice(0, max);
    return {
      source_id: 'ES/BOE',
      doc_id: opts.doc_id,
      keyword: opts.keyword,
      matches,
      total_articles: articles.length,
      url: `${TXT_BASE}${opts.doc_id}`,
    };
  },
};
