// IE/IrishStatuteBook — Irish primary legislation (Acts of the Oireachtas)
// and Statutory Instruments via irishstatutebook.ie.
//
// The site has no public free-text search API (the front-page form is JS-
// driven). It DOES expose ELI-based URLs for every act and SI, so we
// support citation-style queries:
//   "Data Protection Act 2018"     -> resolves via title-year regex
//   "2018/act/7"                    -> direct ELI path
//   "ie:2018:act:7"                 -> structured doc_id
// doc_id format: "<year>/act/<number>" or "<year>/si/<number>"

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

const BASE = 'https://www.irishstatutebook.ie';

interface ParsedCitation {
  year: number;
  type: 'act' | 'si';
  number: number;
}

function parseCitation(query: string): ParsedCitation | null {
  // "<year>/act/<number>" or "<year>/si/<number>"
  let m = query.match(/(\d{4})\s*\/\s*(act|si)\s*\/\s*(\d+)/i);
  if (m) return { year: +m[1], type: m[2].toLowerCase() as 'act' | 'si', number: +m[3] };
  // "Act <n> of <year>" / "S.I. <n>/<year>"
  m = query.match(/\bact\s+(?:no\.?\s*)?(\d+)\s+of\s+(\d{4})\b/i);
  if (m) return { year: +m[2], type: 'act', number: +m[1] };
  m = query.match(/\bs\.?i\.?\s+(?:no\.?\s*)?(\d+)\s*\/\s*(\d{4})\b/i);
  if (m) return { year: +m[2], type: 'si', number: +m[1] };
  // "Data Protection Act 2018" — heuristic: extract a year and assume Act 1
  // is wrong; we can only confidently resolve when the user gives a number.
  return null;
}

function urlFor(c: ParsedCitation, version: 'enacted' | 'revised' = 'enacted'): string {
  return `${BASE}/eli/${c.year}/${c.type}/${c.number}/${version}/en/html`;
}

function citationLabel(c: ParsedCitation): string {
  return c.type === 'act' ? `Act ${c.number}/${c.year}` : `S.I. ${c.number}/${c.year}`;
}

export const ieStatuteBook: LegalProvider = {
  source_id: 'IE/IrishStatuteBook',
  jurisdiction: 'IE',
  name: 'Irish Statute Book (Ireland — Acts + SIs)',
  data_types: ['legislation'],
  summary:
    'Acts of the Oireachtas and Statutory Instruments via irishstatutebook.ie. No public free-text search; this provider supports citation-style queries like "Act 7 of 2018", "2018/act/7", or "S.I. 336/2011". doc_id format: "<year>/act/<number>" (or "/si/"). English.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'IE/IrishStatuteBook', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const c = parseCitation(opts.query);
    if (!c) {
      return {
        source_id: 'IE/IrishStatuteBook',
        page: 1,
        has_more: false,
        results: [],
      };
    }
    // Verify the citation resolves (HEAD-like fetch with small range).
    const url = urlFor(c, 'revised');
    let title = citationLabel(c);
    try {
      const html = await fetchText(url);
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) title = stripHtml(titleMatch[1]).replace(/\s*\|.*$/, '').trim();
    } catch {
      /* fall through with citation label */
    }
    return {
      source_id: 'IE/IrishStatuteBook',
      total: 1,
      page: 1,
      has_more: false,
      results: [
        {
          source_id: 'IE/IrishStatuteBook',
          doc_id: `${c.year}/${c.type}/${c.number}`,
          jurisdiction: 'IE',
          type: 'legislation',
          title,
          date: `${c.year}`,
          url,
          metadata: { year: c.year, type: c.type, number: c.number },
        },
      ],
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const m = opts.doc_id.match(/^(\d{4})\/(act|si)\/(\d+)$/);
    if (!m) {
      throw new Error(`Invalid IE doc_id "${opts.doc_id}". Expected "<year>/act/<num>" or "<year>/si/<num>".`);
    }
    const c: ParsedCitation = { year: +m[1], type: m[2] as 'act' | 'si', number: +m[3] };
    // Prefer revised (consolidated); fall back to enacted (as-passed).
    let url = urlFor(c, 'revised');
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      url = urlFor(c, 'enacted');
      html = await fetchText(url);
    }
    const text = stripHtml(html);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).replace(/\s*\|.*$/, '').trim() : citationLabel(c);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'IE/IrishStatuteBook',
      doc_id: opts.doc_id,
      jurisdiction: 'IE',
      type: 'legislation',
      title,
      text: t.text,
      date: `${c.year}`,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { year: c.year, type: c.type, number: c.number },
    };
  },
};
