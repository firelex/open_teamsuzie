// CA/Justice — Canadian federal Acts and Regulations via the official
// laws-lois.justice.gc.ca XML repository.
//
// Search: lazily fetch /eng/XML/Legis.xml once at first search, build a
//   {title -> UniqueId} index, then return entries whose title contains
//   the query terms. ~5 MB XML, ~10K entries; fits in memory and one
//   round-trip is enough for the lifetime of the process.
// Fetch:  per-act XML at /eng/XML/{UniqueId}.xml.
//
// doc_id format: the act/regulation UniqueId (e.g. "P-21" for the Privacy
// Act, "C-46" for the Criminal Code).

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

const BASE = 'https://laws-lois.justice.gc.ca';
const TOC_URL = `${BASE}/eng/XML/Legis.xml`;

interface TocEntry {
  unique_id: string;
  official_number?: string;
  title: string;
  current_to_date?: string;
  type: 'act' | 'regulation';
  xml_url?: string;
  toc_url?: string;
}

let tocCache: TocEntry[] | null = null;
let tocLoading: Promise<TocEntry[]> | null = null;

async function loadToc(): Promise<TocEntry[]> {
  if (tocCache) return tocCache;
  if (tocLoading) return tocLoading;
  tocLoading = (async () => {
    const xml = await fetchText(TOC_URL);
    const entries: TocEntry[] = [];
    // The XML wraps two sections: <Acts><Act>...</Act>... and <Regulations>...
    for (const [section, type] of [['Act', 'act'], ['Regulation', 'regulation']] as const) {
      const blockRegex = new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)<\\/${section}>`, 'g');
      let m: RegExpExecArray | null;
      while ((m = blockRegex.exec(xml)) !== null) {
        const block = m[1];
        // Filter to English entries only (the XML repeats Acts in eng + fra).
        const lang = block.match(/<Language>([^<]+)<\/Language>/)?.[1];
        if (lang && lang.toLowerCase() !== 'eng') continue;
        const unique_id = block.match(/<UniqueId>([^<]+)<\/UniqueId>/)?.[1];
        if (!unique_id) continue;
        const official_number = block.match(/<OfficialNumber>([^<]*)<\/OfficialNumber>/)?.[1];
        const title = block.match(/<Title>([\s\S]*?)<\/Title>/)?.[1]?.trim() ?? unique_id;
        const current_to_date = block.match(/<CurrentToDate>([^<]+)<\/CurrentToDate>/)?.[1];
        const xml_url = block.match(/<LinkToXML>([^<]+)<\/LinkToXML>/)?.[1];
        const toc_url = block.match(/<LinkToHTMLToC>([^<]+)<\/LinkToHTMLToC>/)?.[1];
        entries.push({
          unique_id,
          official_number: official_number?.trim() || undefined,
          title: stripHtml(title).trim(),
          current_to_date,
          type,
          xml_url,
          toc_url,
        });
      }
    }
    // Deduplicate by unique_id (XML often repeats both eng+fra; we filtered
    // for eng but some entries lack a Language element).
    const seen = new Set<string>();
    tocCache = entries.filter((e) => {
      const key = `${e.type}:${e.unique_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    tocLoading = null;
    return tocCache;
  })();
  return tocLoading;
}

export const caJustice: LegalProvider = {
  source_id: 'CA/Justice',
  jurisdiction: 'CA',
  name: 'Justice Laws (Canada — federal Acts + Regulations)',
  data_types: ['legislation'],
  summary:
    'Canadian federal Acts and Regulations via the Department of Justice XML repository. Search filters titles by keyword (AND on terms ≥3 chars). doc_id is the act\'s UniqueId (e.g. "P-21" = Privacy Act, "C-46" = Criminal Code, "I-3.3" = Income Tax Act). English.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'CA/Justice', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const toc = await loadToc();
    const terms = opts.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    const matches = terms.length === 0
      ? toc.slice(0, 20)
      : toc.filter((e) => {
          const hay = e.title.toLowerCase();
          return terms.every((t) => hay.includes(t));
        });

    const page = opts.page ?? 1;
    const limit = 15;
    const slice = matches.slice((page - 1) * limit, page * limit);
    const results: SearchHit[] = slice.map((e) => ({
      source_id: 'CA/Justice',
      doc_id: e.unique_id,
      jurisdiction: 'CA',
      type: 'legislation',
      title: e.title,
      date: e.current_to_date,
      url: e.toc_url ?? `${BASE}/eng/acts/${e.unique_id}/`,
      metadata: {
        unique_id: e.unique_id,
        official_number: e.official_number,
        type: e.type,
        xml_url: e.xml_url,
      },
    }));
    return {
      source_id: 'CA/Justice',
      total: matches.length,
      page,
      has_more: page * limit < matches.length,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const toc = await loadToc();
    const entry = toc.find((e) => e.unique_id === opts.doc_id);
    const xmlUrl = entry?.xml_url ?? `${BASE}/eng/XML/${opts.doc_id}.xml`;
    const xml = await fetchText(xmlUrl);
    const text = stripHtml(xml);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'CA/Justice',
      doc_id: opts.doc_id,
      jurisdiction: 'CA',
      type: 'legislation',
      title: entry?.title ?? opts.doc_id,
      text: t.text,
      date: entry?.current_to_date,
      url: entry?.toc_url ?? `${BASE}/eng/acts/${opts.doc_id}/`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { unique_id: opts.doc_id, xml_url: xmlUrl },
    };
  },
};
