// CH/Fedlex — Swiss federal legislation via the Fedlex SPARQL endpoint
// (JOLux ontology). Multilingual (DEU/FRA/ITA/ROH).
//
// Two SPARQL hops at runtime: (1) search by title, (2) resolve the
// expression's HTML manifestation for getDocument. Pattern mirrors
// EU/EUR-Lex; no auth.

import { fetchText, stripHtml, truncateText, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const SPARQL_ENDPOINT = 'https://fedlex.data.admin.ch/sparqlendpoint';
const PREFIXES = `
PREFIX jolux: <http://data.legilux.public.lu/resource/ontology/jolux#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lang: <http://publications.europa.eu/resource/authority/language/>
PREFIX ft: <http://publications.europa.eu/resource/authority/file-type/>`;

const LANG_IRI: Record<string, string> = {
  de: 'http://publications.europa.eu/resource/authority/language/DEU',
  fr: 'http://publications.europa.eu/resource/authority/language/FRA',
  it: 'http://publications.europa.eu/resource/authority/language/ITA',
  en: 'http://publications.europa.eu/resource/authority/language/ENG',
};

interface SparqlResults {
  results?: { bindings?: Record<string, { value: string }>[] };
}

function sparqlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function sparqlSelect(query: string): Promise<SparqlResults> {
  const r = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `query=${encodeURIComponent(PREFIXES + '\n' + query)}`,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Fedlex SPARQL ${r.status}: ${t.slice(0, 300)}`);
  }
  return (await r.json()) as SparqlResults;
}

export const chFedlex: LegalProvider = {
  source_id: 'CH/Fedlex',
  jurisdiction: 'CH',
  name: 'Fedlex (Switzerland)',
  data_types: ['legislation'],
  summary:
    'Swiss federal legislation via Fedlex SPARQL. Acts identified by ELI (e.g. https://fedlex.data.admin.ch/eli/cc/27/317_321_377). Multilingual: queries match titles in DE/FR/IT/EN; getDocument returns the German version by default.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'CH/Fedlex', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const escaped = sparqlEscape(opts.query);

    // Filter to expressions whose title contains the query (case-insensitive).
    // Pull date when available, prefer DEU titles for display.
    const query = `
SELECT DISTINCT ?act ?title ?date WHERE {
  ?act jolux:isRealizedBy ?expr .
  ?expr jolux:title ?title .
  OPTIONAL { ?act jolux:dateDocument ?date }
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${escaped}")))
}
ORDER BY DESC(?date)
LIMIT ${limit} OFFSET ${offset}`;

    const data = await sparqlSelect(query);
    const bindings = data.results?.bindings ?? [];
    const results: SearchHit[] = bindings.map((b) => ({
      source_id: 'CH/Fedlex',
      doc_id: b.act.value,
      jurisdiction: 'CH',
      type: 'legislation',
      title: b.title?.value ?? b.act.value,
      date: b.date?.value,
      url: b.act.value,
      metadata: { eli: b.act.value },
    }));
    return { source_id: 'CH/Fedlex', page, has_more: results.length === limit, results };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const lang = (opts.version && LANG_IRI[opts.version.toLowerCase()] ? opts.version.toLowerCase() : 'de') as keyof typeof LANG_IRI;
    const langIri = LANG_IRI[lang];

    // Resolve the HTML manifestation URL for the requested language.
    const query = `
SELECT ?fileUrl WHERE {
  <${opts.doc_id}> jolux:isRealizedBy ?expr .
  ?expr jolux:language <${langIri}> .
  ?expr jolux:isEmbodiedBy ?manif .
  ?manif jolux:format ft:HTML ;
         jolux:isExemplifiedBy ?fileUrl .
}
LIMIT 1`;
    const data = await sparqlSelect(query);
    const fileUrl = data.results?.bindings?.[0]?.fileUrl?.value;
    if (!fileUrl) {
      throw new Error(
        `No HTML manifestation found for ${opts.doc_id} in language "${lang}". Try version="fr" or "it".`,
      );
    }
    const html = await fetchText(fileUrl);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };

    return {
      source_id: 'CH/Fedlex',
      doc_id: opts.doc_id,
      jurisdiction: 'CH',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      url: opts.doc_id,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      version: lang,
      metadata: { html_url: fileUrl },
    };
  },
};
