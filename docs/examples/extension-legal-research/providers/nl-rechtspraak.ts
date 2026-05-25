// NL/Rechtspraak — Dutch judicial decisions via the open-data feed at
// data.rechtspraak.nl.
//
// Search: GET /uitspraken/zoeken?max=N&from=K[&date=YYYY-MM-DD][&subject=...]
//   → Atom XML with ECLI entries. The API does NOT support free-text query;
//   browsing is by date / subject (rechtsgebied) / type. Provided keywords
//   in opts.query are post-filtered against the title.
// Fetch:  GET /uitspraken/content?id=<ECLI> → custom XML with full body.
//
// doc_id = the ECLI (e.g. ECLI:NL:HR:2024:1234).

import { fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const API = 'https://data.rechtspraak.nl/uitspraken';
const VIEWER = 'https://uitspraken.rechtspraak.nl/details';

interface AtomEntry {
  ecli?: string;
  title?: string;
  summary?: string;
  updated?: string;
}

function parseAtomFeed(xml: string): AtomEntry[] {
  const out: AtomEntry[] = [];
  const entryRegex = /<entry\b[\s\S]*?<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[0];
    const id = block.match(/<id[^>]*>([^<]+)<\/id>/)?.[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1];
    const updated = block.match(/<updated[^>]*>([^<]+)<\/updated>/)?.[1];
    out.push({
      ecli: id?.trim(),
      title: title ? stripHtml(title).trim() : undefined,
      summary: summary ? stripHtml(summary).trim().slice(0, 500) : undefined,
      updated,
    });
  }
  return out;
}

export const nlRechtspraak: LegalProvider = {
  source_id: 'NL/Rechtspraak',
  jurisdiction: 'NL',
  name: 'rechtspraak.nl (Netherlands — court decisions)',
  data_types: ['case_law'],
  summary:
    'Dutch court decisions (Hoge Raad, Raad van State, gerechtshoven, rechtbanken) by ECLI. The data.rechtspraak.nl feed supports browsing by date but NOT free-text queries — pass date_from / date_to to narrow, and the provider filters titles client-side for the keyword. doc_id is the ECLI. Dutch.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'case_law') {
      return { source_id: 'NL/Rechtspraak', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const max = 50;
    const params = new URLSearchParams({
      max: String(max),
      from: String((page - 1) * max),
      sort: 'DESC',
      type: 'Uitspraak',
    });
    if (opts.date_from) params.set('date', opts.date_from);
    // The feed accepts only one `date=`; if both date_from and date_to are
    // given we use `date_from` and post-filter. Many tests will only set one.

    const xml = await fetchText(`${API}/zoeken?${params.toString()}`);
    const entries = parseAtomFeed(xml).filter((e) => e.ecli);

    // Client-side keyword filter on title (the API doesn't accept free text).
    const terms = opts.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    const filtered = terms.length === 0
      ? entries
      : entries.filter((e) => {
          const hay = `${e.title ?? ''} ${e.summary ?? ''}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        });

    const results: SearchHit[] = filtered.slice(0, 20).map((e) => ({
      source_id: 'NL/Rechtspraak',
      doc_id: e.ecli!,
      jurisdiction: 'NL',
      type: 'case_law',
      title: e.title ?? e.ecli!,
      snippet: e.summary,
      date: e.updated?.slice(0, 10),
      url: `${VIEWER}?id=${encodeURIComponent(e.ecli!)}`,
      metadata: { ecli: e.ecli },
    }));
    return {
      source_id: 'NL/Rechtspraak',
      page,
      has_more: entries.length >= max,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const xml = await fetchText(`${API}/content?id=${encodeURIComponent(opts.doc_id)}`);
    const text = stripHtml(xml);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    // Pull a few useful fields out of the RDF metadata for the title.
    const courtMatch = xml.match(/<dcterms:creator[^>]*>([^<]+)/);
    const dateMatch = xml.match(/<dcterms:date[^>]*>([^<]+)/);
    return {
      source_id: 'NL/Rechtspraak',
      doc_id: opts.doc_id,
      jurisdiction: 'NL',
      type: 'case_law',
      title: courtMatch ? `${courtMatch[1]} — ${opts.doc_id}` : opts.doc_id,
      text: t.text,
      date: dateMatch?.[1],
      url: `${VIEWER}?id=${encodeURIComponent(opts.doc_id)}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { ecli: opts.doc_id, court: courtMatch?.[1] },
    };
  },
};
