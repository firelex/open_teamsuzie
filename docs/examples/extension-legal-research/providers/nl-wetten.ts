// NL/Wetten — Dutch national legislation via the Overheid.nl SRU 1.2
// service (BWB index) plus wetten.overheid.nl HTML for full text.
//
// Search: GET /sru/Search?version=1.2&operation=searchRetrieve&x-connection=BWB
//         &query=overheidbwb.titel=<keyword>&maximumRecords=N
// Fetch:  GET https://wetten.overheid.nl/{BWBR_id}/<date> → HTML
//         (returns the consolidated regulation text in Dutch)

import {
  fetchText,
  stripHtml,
  truncateText,
  DEFAULT_MAX_TEXT_CHARS,
} from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const SRU = 'https://zoekservice.overheid.nl/sru/Search';
const VIEWER = 'https://wetten.overheid.nl';

interface SruRecord {
  identifier?: string; // "BWBR0005537"
  title?: string;
  modified?: string;
  authority?: string;
}

function parseSruResponse(xml: string): { total: number; records: SruRecord[] } {
  const totalMatch = xml.match(/<numberOfRecords[^>]*>\s*(\d+)/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const records: SruRecord[] = [];
  // Each <record><recordData><gzd>...</gzd></recordData></record>
  const recordRegex = /<recordData[^>]*>([\s\S]*?)<\/recordData>/g;
  let m: RegExpExecArray | null;
  while ((m = recordRegex.exec(xml)) !== null) {
    const block = m[1];
    const id = block.match(/<dcterms:identifier[^>]*>([^<]+)<\/dcterms:identifier>/)?.[1];
    const title = block.match(/<dcterms:title[^>]*>([^<]+)<\/dcterms:title>/)?.[1];
    const modified = block.match(/<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/)?.[1];
    const authority = block.match(/<dcterms:creator[^>]*>([^<]+)<\/dcterms:creator>/)?.[1];
    records.push({ identifier: id?.trim(), title: title?.trim(), modified, authority });
  }
  return { total, records };
}

function escapeCql(value: string): string {
  return value.replace(/"/g, '\\"');
}

export const nlWetten: LegalProvider = {
  source_id: 'NL/Wetten',
  jurisdiction: 'NL',
  name: 'wetten.overheid.nl (Netherlands — national legislation)',
  data_types: ['legislation'],
  summary:
    'Dutch national legislation via the Overheid.nl BWB SRU service. Title-keyword search returns BWBR identifiers (the canonical Dutch law ID, e.g. BWBR0005537 = Algemene wet bestuursrecht). doc_id is the BWBR id; full text fetched from wetten.overheid.nl. Dutch language.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'NL/Wetten', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const max = 10;
    // Multi-word: AND the terms in the title index. SRU 1.2 supports `=` as
    // simple word match; `and` requires both terms to be present in title.
    const terms = opts.query
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .map((t) => `overheidbwb.titel="${escapeCql(t)}"`)
      .join(' and ');
    const cql = terms || `cql.allRecords=1`;
    const params = new URLSearchParams({
      version: '1.2',
      operation: 'searchRetrieve',
      'x-connection': 'BWB',
      query: cql,
      maximumRecords: String(max),
      startRecord: String((page - 1) * max + 1),
    });
    const xml = await fetchText(`${SRU}?${params.toString()}`);
    const { total, records } = parseSruResponse(xml);
    const results: SearchHit[] = records
      .filter((r) => r.identifier)
      .map((r) => ({
        source_id: 'NL/Wetten',
        doc_id: r.identifier!,
        jurisdiction: 'NL',
        type: 'legislation',
        title: r.title ?? r.identifier!,
        date: r.modified,
        url: `${VIEWER}/${r.identifier}`,
        metadata: { bwbr: r.identifier, authority: r.authority },
      }));
    return {
      source_id: 'NL/Wetten',
      total,
      page,
      has_more: page * max < total,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const url = `${VIEWER}/${opts.doc_id}`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'NL/Wetten',
      doc_id: opts.doc_id,
      jurisdiction: 'NL',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { bwbr: opts.doc_id },
    };
  },
};
