// BE/Justel — Belgian federal legislation via ejustice.just.fgov.be.
//
// No public free-text search API. The site exposes ELI year-listings
// (e.g. /eli/loi/2018) which list every published act for that year with
// titles + ELIs. We fetch a year listing on demand and post-filter by
// keyword. Search queries should usually scope to a year; without one we
// scan a 5-year window backwards from "today".
//
// doc_id format: "<type>/<year>/<MM>/<DD>/<numac>"
//   e.g. "loi/2018/07/30/2018040581" = the GDPR national implementation.
//
// All text is in French here; the same numac has parallel /nl/ and /de/
// versions on ejustice. We pick FR as the default.

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

const BASE = 'https://www.ejustice.just.fgov.be';
const TYPES = ['loi', 'arrete', 'decret', 'ordonnance'] as const;
type BeType = (typeof TYPES)[number];

interface YearListEntry {
  type: BeType;
  date: string; // YYYY-MM-DD
  numac: string;
  title: string;
}

const yearCache = new Map<string, YearListEntry[]>();

function cacheKey(type: BeType, year: number): string {
  return `${type}:${year}`;
}

function parseYearListing(html: string, type: BeType): YearListEntry[] {
  const out: YearListEntry[] = [];
  // The HTML is plain (Latin-1) with table rows in HTML-3.0 style: the
  // <td align=left> that holds the title is not explicitly closed; the title
  // text runs from the <td> opening to the next colored metadata block
  // ("<font color = #FF8C00>" marks the start of "Publié le" / "Source" rows).
  // Each entry ends with two ELI links (Moniteur + Justel).
  const eliRegex = new RegExp(
    `/eli/${type}/(\\d{4})/(\\d{2})/(\\d{2})/(\\d+)/(?:moniteur|justel)`,
    'g',
  );
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = eliRegex.exec(html)) !== null) {
    const numac = m[4];
    if (seen.has(numac)) continue;
    seen.add(numac);
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    // Look back to the most recent <td align=left ...> opening, then take
    // text between that and the next "color = #FF8C00" font block (or 800
    // chars of safety net).
    const back = html.slice(Math.max(0, m.index - 1500), m.index);
    const tdIdx = back.lastIndexOf('<td align=left');
    let title = '';
    if (tdIdx >= 0) {
      const tail = back.slice(tdIdx);
      const stop = tail.search(/<font\s+color\s*=\s*#FF8C00/i);
      const titleHtml = stop >= 0 ? tail.slice(0, stop) : tail;
      title = stripHtml(titleHtml).replace(/\s+/g, ' ').trim().slice(0, 300);
    }
    out.push({ type, date, numac, title });
  }
  return out;
}

async function loadYearListing(type: BeType, year: number): Promise<YearListEntry[]> {
  const key = cacheKey(type, year);
  const cached = yearCache.get(key);
  if (cached) return cached;
  const url = `${BASE}/eli/${type}/${year}`;
  let html: string;
  try {
    html = await fetchText(url, { decoder: 'iso-8859-1' });
  } catch {
    return [];
  }
  const entries = parseYearListing(html, type);
  yearCache.set(key, entries);
  return entries;
}

function detectYear(query: string): number | null {
  const m = query.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function detectType(query: string): BeType | null {
  const lower = query.toLowerCase();
  if (lower.includes('arrête') || lower.includes('arrete')) return 'arrete';
  if (lower.includes('décret') || lower.includes('decret')) return 'decret';
  if (lower.includes('ordonnance')) return 'ordonnance';
  if (lower.includes('loi')) return 'loi';
  return null;
}

export const beJustel = {
  source_id: 'BE/Justel',
  jurisdiction: 'BE',
  name: 'Justel / Moniteur belge (Belgium — federal legislation)',
  data_types: ['legislation'],
  summary:
    'Belgian federal legislation via Moniteur belge / Justel. No free-text search; we fetch ELI year-listings (loi/arrête/décret/ordonnance) and filter titles by keyword. Include a 4-digit year in the query (e.g. "GDPR 2018", "responsabilité 2014") to keep the scan to one year. doc_id format: "<type>/<year>/<MM>/<DD>/<numac>". French.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'BE/Justel', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const explicitYear = detectYear(opts.query);
    const explicitType = detectType(opts.query);
    const years = explicitYear
      ? [explicitYear]
      : (() => {
          // No year hint — scan the last 5 years to keep network cost bounded.
          const now = new Date().getFullYear();
          return [now, now - 1, now - 2, now - 3, now - 4];
        })();
    const types = explicitType ? [explicitType] : (['loi'] as BeType[]); // default to loi (federal laws)

    const terms = opts.query
      .toLowerCase()
      .replace(/\b(19\d{2}|20\d{2})\b/g, '')
      .replace(/\b(loi|arrête|arrete|décret|decret|ordonnance)\b/gi, '')
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const hits: SearchHit[] = [];
    for (const year of years) {
      for (const type of types) {
        const entries = await loadYearListing(type, year);
        for (const e of entries) {
          if (terms.length > 0) {
            const hay = e.title.toLowerCase();
            if (!terms.every((t) => hay.includes(t))) continue;
          }
          hits.push({
            source_id: 'BE/Justel',
            doc_id: `${e.type}/${e.date.replace(/-/g, '/')}/${e.numac}`,
            jurisdiction: 'BE',
            type: 'legislation',
            title: e.title,
            date: e.date,
            url: `${BASE}/eli/${e.type}/${e.date.replace(/-/g, '/')}/${e.numac}/justel`,
            metadata: { numac: e.numac, type: e.type },
          });
          if (hits.length >= 20) break;
        }
        if (hits.length >= 20) break;
      }
      if (hits.length >= 20) break;
    }

    return {
      source_id: 'BE/Justel',
      page: 1,
      has_more: false,
      results: hits.slice(0, 20),
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // doc_id = "<type>/<year>/<MM>/<DD>/<numac>"
    const m = opts.doc_id.match(/^([a-zA-Z]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)$/);
    if (!m) {
      throw new Error(`Invalid BE doc_id "${opts.doc_id}". Expected "<type>/<year>/<MM>/<DD>/<numac>".`);
    }
    const url = `${BASE}/eli/${m[1]}/${m[2]}/${m[3]}/${m[4]}/${m[5]}/justel`;
    const html = await fetchText(url, { decoder: 'iso-8859-1' });
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'BE/Justel',
      doc_id: opts.doc_id,
      jurisdiction: 'BE',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      date: `${m[2]}-${m[3]}-${m[4]}`,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { numac: m[5], be_type: m[1] },
    };
  },
} as LegalProvider;
