// EU/CURIA — Court of Justice of the EU case law (judgments, orders,
// AG opinions) via the same publications.europa.eu SPARQL endpoint as
// EUR-Lex, restricted to CJEU resource types. Full text by CELEX +
// language via CELLAR content negotiation.

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
const CELLAR_BASE = 'http://publications.europa.eu/resource/cellar/';
const EUR_LEX_HTML = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:';

interface SparqlResults {
  results?: { bindings?: Record<string, { value: string }>[] };
}

function sparqlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function sparqlSelect(query: string): Promise<SparqlResults> {
  const params = new URLSearchParams({ query, format: 'application/sparql-results+json' });
  return fetchJson<SparqlResults>(`${SPARQL_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'suzielaw-legal-research/1.0' },
  });
}

export const euCuria: LegalProvider = {
  source_id: 'EU/CURIA',
  jurisdiction: 'EU',
  name: 'CURIA (Court of Justice of the EU)',
  data_types: ['case_law'],
  summary:
    'CJEU judgments, orders, and Advocate General opinions via SPARQL. Each case has a CELEX (sector 6) and an ECLI. Best for finding CJEU rulings by keyword or year.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    const limit = 15;
    const offset = (page - 1) * limit;
    const escaped = sparqlEscape(opts.query);

    const dateFilter =
      opts.date_from || opts.date_to
        ? `FILTER(${[
            opts.date_from ? `?date >= "${opts.date_from}"^^xsd:date` : '',
            opts.date_to ? `?date <= "${opts.date_to}"^^xsd:date` : '',
          ]
            .filter(Boolean)
            .join(' && ')})`
        : '';

    // CJEU CELEX numbers all start with "6"; resource-type IRIs filter to
    // judgments/orders/opinions specifically.
    const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lang: <http://publications.europa.eu/resource/authority/language/>
PREFIX rt: <http://publications.europa.eu/resource/authority/resource-type/>
SELECT DISTINCT ?celex ?title ?date ?ecli WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  ?work cdm:work_has_resource-type ?rt .
  OPTIONAL { ?work cdm:work_date_document ?date }
  OPTIONAL { ?work cdm:case-law_ecli ?ecli }
  ?expr cdm:expression_belongs_to_work ?work ;
        cdm:expression_uses_language lang:ENG ;
        cdm:expression_title ?title .
  FILTER(?rt IN (rt:JUDG, rt:ORDER, rt:OPIN_AG))
  FILTER(STRSTARTS(?celex, "6"))
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${escaped}")))
  ${dateFilter}
}
ORDER BY DESC(?date)
LIMIT ${limit} OFFSET ${offset}`.trim();

    const data = await sparqlSelect(query);
    const bindings = data.results?.bindings ?? [];
    const results: SearchHit[] = bindings.map((b) => ({
      source_id: 'EU/CURIA',
      doc_id: b.celex.value,
      jurisdiction: 'EU',
      type: 'case_law',
      title: b.title?.value ?? b.celex.value,
      date: b.date?.value,
      url: `${EUR_LEX_HTML}${b.celex.value}`,
      metadata: { celex: b.celex.value, ecli: b.ecli?.value },
    }));

    return { source_id: 'EU/CURIA', page, has_more: results.length === limit, results };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const celex = opts.doc_id;
    // CELLAR content negotiation: Accept-Language is required.
    const url = `http://publications.europa.eu/resource/celex/${celex}`;
    const html = await fetchText(url, {
      headers: {
        Accept: 'text/html, application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };

    return {
      source_id: 'EU/CURIA',
      doc_id: celex,
      jurisdiction: 'EU',
      type: 'case_law',
      title: `CELEX ${celex}`,
      text: t.text,
      url: `${EUR_LEX_HTML}${celex}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { celex, cellar_base: CELLAR_BASE },
    };
  },
};
