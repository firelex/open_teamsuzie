// CH/Entscheidsuche — Swiss federal and cantonal court decisions via
// entscheidsuche.ch, the open collection run by the non-profit association
// "Verein entscheidsuche.ch". It mirrors the decisions the courts publish
// (Federal Supreme Court incl. the BGE/ATF/DTF leading cases, federal
// administrative, criminal and patent courts, and the cantonal courts, e.g.
// Zurich). The official bger.ch site blocks automated access; this is a
// non-official mirror of official texts, so cite the court's own reference.
//
// Terms (checked 2026-11-17): robots.txt allows everything except /hidden and
// /archiv. The "Daten/API" page says the collected data are free for anyone to
// use and process further, asking that entscheidsuche.ch be named as the
// source; the API documentation (https://entscheidsuche.ch/pdf/EntscheidsucheAPI.pdf,
// 3.7.2022) says the same, asks users not to put too much load on the server,
// and asks commercial users to consider a donation (not a legal requirement).
// So: one request per search or fetch, no crawling.
//
// Endpoints:
//   POST https://entscheidsuche.ch/_search.php — Elasticsearch query DSL over
//        every court's index (the documented search API; the site's own UI
//        uses the same index).
//   https://entscheidsuche.ch/docs/<Spider>/<id>.html|.pdf — the stored copy
//        of each decision, as the court served it (linked as `url`).
//
// Search: a free-text query (German, French or Italian) runs as
// `simple_query_string` (AND) over title, abstract (Regeste), court
// metadata, reference and full text — `simple_query_string` because the
// stricter `query_string` rejects input like "4A_123/2023". The query is also
// matched as a phrase against the `reference` field, and BGE/ATF/DTF
// citations are normalized to the "BGE 132 III 115" form the index stores, so
// a reference search ranks the exact decision first.
//
// getDocument: doc_id is the index id (e.g. "CH_BGE_005_BGE-132-III-115_2006",
// "CH_BGer_004_4A-123-2023_2023-03-07"). The text comes from the index's
// `attachment.content`, i.e. entscheidsuche's own text extraction of the
// stored HTML or PDF. Limits: for PDFs it keeps page headers/footers and
// layout whitespace; scanned PDFs without a text layer have no text (we throw).
// Dates: BGE leading cases carry only the year (stored as YYYY-01-01), and
// entscheidsuche stores 2021-01-01 when a court gave no date at all.

import { DEFAULT_TIMEOUT_MS, ProviderError, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const SOURCE_ID = 'CH/Entscheidsuche';
const SEARCH_URL = 'https://entscheidsuche.ch/_search.php';
const PAGE_SIZE = 10;
const TEXT_FIELDS = ['title.*^5', 'abstract.*^3', 'meta.*^10', 'attachment.content', 'reference^3'];

type LangMap = Partial<Record<'de' | 'fr' | 'it', string>>;

interface EsSource {
  id: string;
  date?: string;
  canton?: string;
  language?: string;
  reference?: string[];
  hierarchy?: string[];
  title?: LangMap;
  abstract?: LangMap;
  meta?: LangMap;
  attachment?: {
    content_type?: string;
    language?: string;
    content_url?: string;
    content?: string;
  };
}

interface EsHit {
  _id: string;
  _source: EsSource;
  highlight?: Record<string, string[]>;
}

interface EsResponse {
  hits?: { total?: { value: number }; hits: EsHit[] };
  error?: { type?: string; reason?: string; root_cause?: { reason?: string }[] };
}

async function esSearch(body: Record<string, unknown>): Promise<EsResponse> {
  const r = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await r.text();
  let data: EsResponse;
  try {
    data = JSON.parse(text) as EsResponse;
  } catch {
    throw new ProviderError(`Entscheidsuche search HTTP ${r.status}: ${text.slice(0, 300)}`, SOURCE_ID, r.status);
  }
  if (!r.ok || data.error || !data.hits) {
    const reason = data.error?.root_cause?.[0]?.reason ?? data.error?.reason ?? text.slice(0, 300);
    throw new ProviderError(`Entscheidsuche search failed (HTTP ${r.status}): ${reason}`, SOURCE_ID, r.status);
  }
  return data;
}

/** The text in the decision's own language, else German, French, Italian in that order. */
function pickLang(map: LangMap | undefined, lang: string | undefined): string | undefined {
  if (!map) return undefined;
  const own = lang === 'de' || lang === 'fr' || lang === 'it' ? map[lang] : undefined;
  return (own ?? map.de ?? map.fr ?? map.it)?.trim() || undefined;
}

/** "ATF 132 III 115" / "DTF 132 III 115" / "BGE 132 III 115" → "BGE 132 III 115", as the index stores it. */
function bgeCitations(query: string): string[] {
  const out: string[] = [];
  const re = /\b(?:BGE|ATF|DTF)\s+(\d{1,3})\s+(Ia|Ib|IV|V|III|II|I)\s+(\d{1,4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const part = m[2].length === 2 && /^i[ab]$/i.test(m[2]) ? 'I' + m[2][1].toLowerCase() : m[2].toUpperCase();
    out.push(`BGE ${m[1]} ${part} ${m[3]}`);
  }
  return out;
}

function toHit(h: EsHit): SearchHit {
  const s = h._source;
  const lang = s.attachment?.language ?? s.language;
  const court = pickLang(s.meta, lang);
  const highlight = h.highlight?.['attachment.content']?.[0];
  const abstract = pickLang(s.abstract, lang);
  const snippet = highlight ? stripHtml(highlight) : abstract ? stripHtml(abstract).slice(0, 500) : undefined;
  const url = s.attachment?.content_url;
  if (!url) throw new ProviderError(`Entscheidsuche hit ${h._id} has no document URL`, SOURCE_ID);
  return {
    source_id: SOURCE_ID,
    doc_id: h._id,
    jurisdiction: 'CH',
    type: 'case_law',
    title: pickLang(s.title, lang) ?? h._id,
    snippet,
    date: s.date,
    url,
    metadata: {
      court,
      court_code: s.hierarchy?.[1],
      canton: s.canton?.toUpperCase(),
      reference: s.reference,
      language: lang,
      format: s.attachment?.content_type?.includes('pdf') ? 'pdf' : 'html',
    },
  };
}

export const chEntscheidsuche: LegalProvider = {
  source_id: SOURCE_ID,
  jurisdiction: 'CH',
  name: 'Entscheidsuche (Switzerland)',
  data_types: ['case_law'],
  summary:
    'Swiss court decisions, federal and cantonal: Federal Supreme Court (incl. BGE/ATF/DTF leading cases), federal administrative and criminal courts, and cantonal courts (e.g. Zurich), via entscheidsuche.ch, a non-official open mirror of the published decisions. Search by reference ("BGE 132 III 115", "4A_123/2023") or keywords in German, French or Italian. For federal statutes use CH/Fedlex.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    if (opts.type && opts.type !== 'case_law') {
      return { source_id: SOURCE_ID, page, has_more: false, results: [] };
    }
    const query = opts.query.trim();
    if (!query) throw new ProviderError('Entscheidsuche search needs a non-empty query', SOURCE_ID);

    const should: Record<string, unknown>[] = [
      { simple_query_string: { query, default_operator: 'AND', fields: TEXT_FIELDS } },
      { match_phrase: { reference: { query, boost: 50 } } },
      ...bgeCitations(query).map((c) => ({ match_phrase: { reference: { query: c, boost: 50 } } })),
    ];
    const filter: Record<string, unknown>[] = [];
    if (opts.date_from || opts.date_to) {
      const range: Record<string, string> = {};
      if (opts.date_from) range.gte = opts.date_from;
      if (opts.date_to) range.lte = opts.date_to;
      filter.push({ range: { date: range } });
    }

    const from = (page - 1) * PAGE_SIZE;
    const data = await esSearch({
      size: PAGE_SIZE,
      from,
      track_total_hits: true,
      _source: { excludes: ['attachment.content'] },
      query: { bool: { should, minimum_should_match: 1, filter } },
      highlight: { fields: { 'attachment.content': { fragment_size: 250, number_of_fragments: 1 } } },
      sort: ['_score', { date: 'desc' }],
    });
    const total = data.hits!.total?.value ?? 0;
    const results = data.hits!.hits.map(toHit);
    return { source_id: SOURCE_ID, total, page, has_more: from + results.length < total, results };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const data = await esSearch({ query: { ids: { values: [opts.doc_id] } } });
    const h = data.hits!.hits[0];
    if (!h) throw new ProviderError(`Entscheidsuche has no decision with id "${opts.doc_id}"`, SOURCE_ID, 404);
    const hit = toHit(h);
    const raw = h._source.attachment?.content;
    if (!raw || !raw.trim()) {
      throw new ProviderError(
        `Entscheidsuche holds no extracted text for "${opts.doc_id}" (probably a scanned PDF); open ${hit.url}`,
        SOURCE_ID,
      );
    }
    const text = raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: SOURCE_ID,
      doc_id: opts.doc_id,
      jurisdiction: 'CH',
      type: 'case_law',
      title: hit.title,
      text: t.text,
      date: hit.date,
      url: hit.url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: hit.metadata,
    };
  },
};
