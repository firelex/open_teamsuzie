// CoE/HUDOC — European Court of Human Rights case law.
//
// HUDOC's modern frontend uses an authenticated JSON API, but the public
// RSS transform endpoint (`/app/transform/rss`) is reachable without auth
// and returns search results in plain XML. Full text comes from the
// docx-to-HTML conversion endpoint with the itemid.
//
// Quirks: `library` param must include the language ("echreng" for
// English). Query syntax is Lucene-ish — the standard prefix
// `(contentsitename=ECHR)` restricts to ECHR judgments/decisions.

import { fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const RSS_URL = 'https://hudoc.echr.coe.int/app/transform/rss';
const FULL_TEXT_URL = 'https://hudoc.echr.coe.int/app/conversion/docx/html/body';
const PAGE_BASE = 'https://hudoc.echr.coe.int/eng';

interface RssEntry {
  title: string;
  date?: string;
  description?: string;
  itemid?: string;
}

function parseRss(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[0];
    const title = stripHtml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const date = block.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1];
    const description = stripHtml(block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? '').slice(0, 500);
    // Link looks like http://hudoc.echr.coe.int/eng#{"itemid":["001-249973"]}
    const linkRaw = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? '';
    const idMatch = linkRaw.match(/"itemid":\s*\["([^"]+)"\]/);
    entries.push({ title, date, description, itemid: idMatch?.[1] });
  }
  return entries;
}

// Filter to actual judgments + decisions (English/French). Without this the
// RSS feed returns press releases ("Forthcoming judgments…") whose itemids
// (003-*) have no full text and 204 from the conversion endpoint.
const DOC_TYPE_FILTER =
  '(doctype="HEJUD" OR doctype="HFJUD" OR doctype="HEDEC" OR doctype="HFDEC")';

function buildQuery(query: string): string {
  const safe = query.replace(/[\\]/g, ' ').trim();
  return `(contentsitename=ECHR) AND ${DOC_TYPE_FILTER} AND ${safe}`;
}

export const coeHudoc: LegalProvider = {
  source_id: 'CoE/HUDOC',
  jurisdiction: 'CoE',
  name: 'HUDOC (European Court of Human Rights)',
  data_types: ['case_law'],
  summary:
    'European Court of Human Rights judgments and decisions via HUDOC. doc_id is the itemid (e.g. "001-249973"). Search supports Lucene-ish syntax — quoted phrases, AND/OR/NOT. Tip: include phrasing like "fair trial" or "Article 6" to narrow.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'case_law') {
      return { source_id: 'CoE/HUDOC', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const length = 15;
    const params = new URLSearchParams({
      library: 'echreng',
      query: buildQuery(opts.query),
      sort: 'kpdate Descending',
      start: String((page - 1) * length),
      length: String(length),
    });
    const xml = await fetchText(`${RSS_URL}?${params.toString()}`);
    const entries = parseRss(xml).filter((e) => e.itemid);
    const results: SearchHit[] = entries.map((e) => ({
      source_id: 'CoE/HUDOC',
      doc_id: e.itemid!,
      jurisdiction: 'CoE',
      type: 'case_law',
      title: e.title,
      snippet: e.description,
      date: e.date,
      url: `${PAGE_BASE}#{"itemid":["${e.itemid}"]}`,
      metadata: { itemid: e.itemid },
    }));
    return { source_id: 'CoE/HUDOC', page, has_more: results.length >= length, results };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const url = `${FULL_TEXT_URL}?library=ECHR&id=${encodeURIComponent(opts.doc_id)}`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'CoE/HUDOC',
      doc_id: opts.doc_id,
      jurisdiction: 'CoE',
      type: 'case_law',
      title: opts.doc_id,
      text: t.text,
      url: `${PAGE_BASE}#{"itemid":["${opts.doc_id}"]}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { html_url: url },
    };
  },
};
