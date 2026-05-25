// EU/EUR-Lex — EU legislation (and some case law) via the public SPARQL
// endpoint at publications.europa.eu, plus CELLAR content negotiation
// for full text by CELEX number.
//
// We don't try to wrap EUR-Lex's web search frontend (CAPTCHA / WAF). The
// SPARQL endpoint is public, no-auth, and reliable for free-text title +
// metadata queries — which is what we need for runtime search.

import { fetchText, fetchJson, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const SPARQL_ENDPOINT = 'http://publications.europa.eu/webapi/rdf/sparql';
const CELLAR_BASE = 'http://publications.europa.eu/resource/celex/';
const EUR_LEX_HTML = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:';

interface SparqlBinding {
  type: string;
  value: string;
  'xml:lang'?: string;
  datatype?: string;
}
interface SparqlResults {
  results?: { bindings?: Record<string, SparqlBinding>[] };
}

function sparqlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function sparqlSelect(query: string): Promise<SparqlResults> {
  const params = new URLSearchParams({ query, format: 'application/sparql-results+json' });
  return fetchJson<SparqlResults>(`${SPARQL_ENDPOINT}?${params.toString()}`, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'suzielaw-legal-research/1.0',
    },
  });
}

export const euEurLex: LegalProvider = {
  source_id: 'EU/EUR-Lex',
  jurisdiction: 'EU',
  name: 'EUR-Lex (European Union)',
  data_types: ['legislation', 'case_law'],
  summary:
    'EU treaties, regulations, directives, decisions, and CJEU case law via the public SPARQL endpoint. Documents identified by CELEX number (e.g. 32016R0679 = GDPR). Best for keyword + date filtering on titles.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    const limit = 15;
    const offset = (page - 1) * limit;
    const escaped = sparqlEscape(opts.query);

    // SPARQL: filter by title containing query, restrict to English expression,
    // optional date range. Type filter (legislation vs case_law) maps to CELEX
    // sector prefixes — sectors 3 = legislation, 6 = case law (judgments).
    const sectorFilter =
      opts.type === 'case_law'
        ? 'FILTER(STRSTARTS(?celex, "6"))'
        : opts.type === 'legislation'
          ? 'FILTER(STRSTARTS(?celex, "3") || STRSTARTS(?celex, "1"))'
          : '';

    const dateFilter =
      opts.date_from || opts.date_to
        ? `FILTER(${[
            opts.date_from ? `?date >= "${opts.date_from}"^^xsd:date` : '',
            opts.date_to ? `?date <= "${opts.date_to}"^^xsd:date` : '',
          ]
            .filter(Boolean)
            .join(' && ')})`
        : '';

    const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lang: <http://publications.europa.eu/resource/authority/language/>
SELECT DISTINCT ?celex ?title ?date WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?work cdm:work_date_document ?date }
  ?expr cdm:expression_belongs_to_work ?work ;
        cdm:expression_uses_language lang:ENG ;
        cdm:expression_title ?title .
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${escaped}")))
  ${sectorFilter}
  ${dateFilter}
}
ORDER BY DESC(?date)
LIMIT ${limit} OFFSET ${offset}`.trim();

    const data = await sparqlSelect(query);
    const bindings = data.results?.bindings ?? [];

    const results: SearchHit[] = bindings.map((b) => {
      const celex = b.celex?.value ?? '';
      const isCaseLaw = celex.startsWith('6');
      return {
        source_id: 'EU/EUR-Lex',
        doc_id: celex,
        jurisdiction: 'EU',
        type: isCaseLaw ? 'case_law' : 'legislation',
        title: b.title?.value ?? celex,
        date: b.date?.value,
        url: `${EUR_LEX_HTML}${celex}`,
        metadata: { celex },
      };
    });

    return {
      source_id: 'EU/EUR-Lex',
      page,
      has_more: results.length === limit,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const celex = opts.doc_id;
    // CELLAR content negotiation. Accept-Language is *required* — without
    // it CELLAR returns "Invalid content type CONTENT_STREAM without language".
    const url = `${CELLAR_BASE}${celex}`;
    const html = await fetchText(url, {
      headers: {
        Accept: 'text/html, application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    const isCaseLaw = celex.startsWith('6');

    return {
      source_id: 'EU/EUR-Lex',
      doc_id: celex,
      jurisdiction: 'EU',
      type: isCaseLaw ? 'case_law' : 'legislation',
      title: `CELEX ${celex}`,
      text: t.text,
      url: `${EUR_LEX_HTML}${celex}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { celex, cellar_url: url },
    };
  },
};
