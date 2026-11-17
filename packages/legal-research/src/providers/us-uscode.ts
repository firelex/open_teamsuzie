// US/USCode — the United States Code (federal statutes) from the Office of
// the Law Revision Counsel (OLRC) of the House of Representatives.
//
// Search: citation → GET /us/usc/t{title}/s{section}/ (HTML, one page per section)
//         otherwise → the Popular Name Table, GET /popularnames/popularnames.html
//                     (one ~8 MB static page, fetched once and kept in memory)
// Fetch:  GET /us/usc/t{title}/s{section}/ → HTML, parsed to plain text
//
// Keyword search is limited to what the source offers without a key: the
// Popular Name Table, i.e. the names of Acts ("Lanham Act", "Defend Trade
// Secrets Act of 2016") and where each sits in the Code. There is no
// full-text search: OLRC's own site currently runs in a "temporary format"
// without one, and its browse index (/search.json.gz) answers 403 to
// programmatic clients, so it is not used. GovInfo's API has full-text search
// but needs an api.data.gov key; it is not used here.
//
// doc_id is the section's path on uscode.house.gov, "t15/s1125"; getDocument
// also accepts a citation ("15 U.S.C. 1125"). Robots.txt on uscode.house.gov
// blocks only the Slurp crawler; the Code is a work of the US Government and
// in the public domain (17 U.S.C. 105).

import { fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
  FindInDocumentOpts,
  FindInDocumentResult,
  ArticleMatch,
} from '../types.js';

const SOURCE_ID = 'US/USCode';
const BASE = 'https://uscode.house.gov';
const PER_PAGE = 10;

interface SectionRef {
  /** Title number, with "a" for an appendix ("5a"). */
  title: string;
  /** Section number as the Code writes it, with ASCII hyphens ("78j-1"). */
  section: string;
}

function docIdOf(ref: SectionRef): string {
  return `t${ref.title}/s${ref.section}`;
}

function sectionUrl(ref: SectionRef): string {
  return `${BASE}/us/usc/${docIdOf(ref)}/`;
}

function citationOf(ref: SectionRef): string {
  return `${ref.title} U.S.C. ${ref.section}`;
}

// "15 U.S.C. 1125", "15 USC § 1125(a)(1)", "18 U.S.C.A. §1836", "Title 15, section 1125".
const CITATION_RE =
  /^\s*(?:title\s+)?(\d{1,2}a?)\s*(?:,\s*)?(?:U\.?\s?S\.?\s?C\.?(?:\s?A\.?)?|(?=sec|§))\s*(?:§{1,2}|sec(?:tion|s?\.)?)?\s*(\d+[0-9A-Za-z]*(?:[-–][0-9A-Za-z]+)*)((?:\([0-9A-Za-z]+\))*)\s*(?:et\.?\s+seq\.?)?\s*$/i;

function parseCitation(query: string): (SectionRef & { subsection: string[] }) | null {
  const m = query.match(CITATION_RE);
  if (!m) return null;
  return {
    title: m[1].toLowerCase(),
    section: m[2].replace(/–/g, '-'),
    subsection: Array.from(m[3].matchAll(/\(([0-9A-Za-z]+)\)/g)).map((s) => s[1]),
  };
}

function parseDocId(docId: string): SectionRef {
  const path = docId.trim().match(/^t(\d{1,2}a?)\/s([0-9A-Za-z]+(?:[-–][0-9A-Za-z]+)*)\/?$/i);
  if (path) return { title: path[1].toLowerCase(), section: path[2].replace(/–/g, '-') };
  const cite = parseCitation(docId);
  if (cite) return { title: cite.title, section: cite.section };
  throw new Error(`Invalid US Code doc_id "${docId}". Expected "t15/s1125" or a citation like "15 U.S.C. 1125".`);
}

// stripHtml decodes &amp;, &nbsp; and numeric entities; the pages also use a few named ones.
const NAMED_ENTITIES: Record<string, string> = {
  apos: "'", ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', sect: '§', laquo: '«', raquo: '»',
};

function toText(html: string): string {
  const decoded = html.replace(/&(apos|ldquo|rdquo|lsquo|rsquo|mdash|ndash|sect|laquo|raquo);/g, (_, n: string) => NAMED_ENTITIES[n]);
  return stripHtml(decoded)
    .replace(/⁠/g, '') // word joiners around em dashes
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -----------------------------------------------------------------------------
// Section pages
// -----------------------------------------------------------------------------

interface SectionPage {
  ref: SectionRef;
  url: string;
  /** "15 U.S.C. § 1125: False designations of origin, ..." */
  title: string;
  heading: string;
  /** "Public Law 119-142 (November 10, 2026)" — how far the text is current. */
  current_through?: string;
  /** Title and chapter the section sits in. */
  context: string[];
  /** The statutory text as HTML (inside .statutory-body-container). */
  bodyHtml: string;
  sourceCredit: string;
  notes: string;
}

async function loadSection(ref: SectionRef): Promise<SectionPage | null> {
  const url = sectionUrl(ref);
  let html: string;
  try {
    html = await fetchText(url);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
  const title = toText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s*-\s*US Code\s*$/, '');
  const heading = toText(html.match(/<h3 class="section-head">([\s\S]*?)<\/h3>/i)?.[1] ?? '');
  const bodyStart = html.indexOf('<div class="statutory-body-container">');
  const creditStart = html.indexOf('<p class="source-credit"');
  if (!heading || bodyStart < 0) {
    throw new Error(`US Code page ${url} has no section heading or statutory text; the page layout may have changed.`);
  }
  // The section text runs up to the source credit (or, for sections without one, the notes / page end).
  const notesStart = html.indexOf('<div class="note-block"');
  const pageEnd = html.indexOf('<div id="footer');
  const bodyEnd = [creditStart, notesStart, pageEnd].filter((i) => i > bodyStart).sort((a, b) => a - b)[0] ?? html.length;
  const bodyHtml = html.slice(bodyStart, bodyEnd);
  const sourceCredit = creditStart >= 0 ? toText(html.slice(creditStart, html.indexOf('</p>', creditStart) + 4)) : '';
  const notes = notesStart >= 0 ? toText(html.slice(notesStart, pageEnd > notesStart ? pageEnd : html.length)) : '';
  const context = [
    html.match(/<span class="titleExpcite">([\s\S]*?)<\/span>/i)?.[1],
    ...Array.from(html.matchAll(/<span class="parent\d+ExpCite">([\s\S]*?)<\/span>/gi)).map((m) => m[1]),
  ]
    .filter((s): s is string => Boolean(s))
    .map(toText);
  const current = html.match(/laws in effect through (Public Law [^<]+?)\.?\s*<\/span>/i)?.[1];
  return { ref, url, title: title || heading, heading, current_through: current, context, bodyHtml, sourceCredit, notes };
}

function requireSection(page: SectionPage | null, ref: SectionRef): SectionPage {
  if (!page) {
    throw new Error(`${citationOf(ref)} was not found on uscode.house.gov (${sectionUrl(ref)} answered 404).`);
  }
  return page;
}

/** Top-level subsections: each begins with a plain .statutory-body paragraph that opens with "(x)". */
function splitSubsections(bodyHtml: string): ArticleMatch[] {
  const paragraphs = Array.from(bodyHtml.matchAll(/<p class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g));
  const out: ArticleMatch[] = [];
  for (const [, cls, inner] of paragraphs) {
    const text = toText(inner);
    const marker = cls === 'statutory-body' ? text.match(/^\(([0-9A-Za-z]+)\)/) : null;
    if (marker || out.length === 0) {
      out.push({ article_number: marker ? `(${marker[1]})` : '', text });
    } else {
      out[out.length - 1].text += `\n${text}`;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Popular Name Table
// -----------------------------------------------------------------------------

interface PopularName {
  name: string;
  /** Where the Act is classified: the first section linked from its entry. */
  ref?: SectionRef;
  /** The entry's citation lines, e.g. "July 5, 1946, ch. 540, 60 Stat. 427 (15 U.S.C. 1051 et seq.)". */
  cites: string[];
  /** Other notes on the entry: "Also known as ...", "Short title, see 15 U.S.C. 1051 note". */
  info: string[];
  /** Name of the entry this one refers to ("See Labor-Management Reporting and Disclosure Act of 1959"). */
  see?: string;
  /** Date of the first enactment listed, YYYY-MM-DD. */
  date?: string;
}

let popularCache: Map<string, PopularName> | null = null;
let popularLoading: Promise<Map<string, PopularName>> | null = null;

async function loadPopularNames(): Promise<Map<string, PopularName>> {
  if (popularCache) return popularCache;
  if (popularLoading) return popularLoading;
  popularLoading = (async () => {
    try {
      const html = await fetchText(`${BASE}/popularnames/popularnames.html`);
      const map = new Map<string, PopularName>();
      const blocks = html.split(/<div id='[^']*' class='popular-name-table-entry'[^>]*>/).slice(1);
      for (const raw of blocks) {
        const block = raw.slice(0, raw.indexOf('</div>'));
        const name = toText(block.match(/<p class='popular-name'>([\s\S]*?)<\/p>/)?.[1] ?? '');
        if (!name) continue;
        const entry: PopularName = { name, cites: [], info: [] };
        for (const m of block.matchAll(/<p class='popular-name-information' content-type='([^']+)'([^>]*)>([\s\S]*?)<\/p>/g)) {
          const [, kind, attrs, inner] = m;
          const text = toText(inner);
          if (kind === 'cite') {
            entry.cites.push(text);
            if (!entry.date) entry.date = attrs.match(/datekey='([^']+)'/)?.[1];
          } else if (kind === 'see') {
            entry.see = text.replace(/^See\s+/i, '');
          } else {
            entry.info.push(text);
          }
        }
        const link = block.match(/href="\/us\/usc\/t(\d{1,2}a?)\/s([^/"]+)\/"/);
        if (link) entry.ref = { title: link[1], section: link[2] };
        map.set(name.toLowerCase(), entry);
      }
      if (map.size === 0) {
        throw new Error('The US Code Popular Name Table parsed to no entries; the page layout may have changed.');
      }
      popularCache = map;
      return map;
    } finally {
      popularLoading = null;
    }
  })();
  return popularLoading;
}

function rankPopular(entries: PopularName[], query: string): PopularName[] {
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const score = (e: PopularName): number => {
    const n = e.name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
  };
  return entries
    .filter((e) => {
      const hay = `${e.name}\n${e.info.join('\n')}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => score(a) - score(b) || a.name.length - b.name.length || a.name.localeCompare(b.name));
}

// -----------------------------------------------------------------------------
// Provider
// -----------------------------------------------------------------------------

export const usUSCode: LegalProvider = {
  source_id: SOURCE_ID,
  jurisdiction: 'US',
  name: 'United States Code (Office of the Law Revision Counsel)',
  data_types: ['legislation'],
  summary:
    'US federal statutes (the United States Code, Titles 1–54) from the House Office of the Law Revision Counsel, as currently in force. Search by citation ("15 U.S.C. 1125", "18 USC 1836") or by an Act\'s popular name ("Lanham Act", "Defend Trade Secrets Act"); there is no full-text search. doc_id is "t15/s1125".',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: SOURCE_ID, page, has_more: false, results: [] };
    }
    const query = opts.query.trim();
    if (!query) throw new Error('US Code search needs a citation or an Act name.');

    const cite = parseCitation(query);
    if (cite) {
      if (page > 1) return { source_id: SOURCE_ID, total: 1, page, has_more: false, results: [] };
      const section = await loadSection(cite);
      if (!section) return { source_id: SOURCE_ID, total: 0, page, has_more: false, results: [] };
      const anchor = cite.subsection.length ? `#${cite.subsection.join('-')}` : '';
      const hit: SearchHit = {
        source_id: SOURCE_ID,
        doc_id: docIdOf(cite),
        jurisdiction: 'US',
        type: 'legislation',
        title: section.title,
        snippet: toText(section.bodyHtml).slice(0, 500),
        url: section.url + anchor,
        metadata: {
          citation: citationOf(cite),
          subsection: cite.subsection.length ? cite.subsection : undefined,
          context: section.context,
          current_through: section.current_through,
        },
      };
      return { source_id: SOURCE_ID, total: 1, page, has_more: false, results: [hit] };
    }

    const table = await loadPopularNames();
    let matches = rankPopular(Array.from(table.values()), query);
    if (opts.date_from) matches = matches.filter((e) => e.date && e.date >= opts.date_from!);
    if (opts.date_to) matches = matches.filter((e) => e.date && e.date <= opts.date_to!);

    const results: SearchHit[] = [];
    const seen = new Set<string>();
    for (const e of matches) {
      // A "See X" entry points at another entry; report it under the target's location.
      const target = e.see ? table.get(e.see.toLowerCase()) : e;
      if (!target?.ref) continue; // not classified to a section of the Code
      const key = `${e.name}|${docIdOf(target.ref)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        source_id: SOURCE_ID,
        doc_id: docIdOf(target.ref),
        jurisdiction: 'US',
        type: 'legislation',
        title: e.see ? `${e.name} (see ${target.name})` : e.name,
        snippet: [...target.cites, ...target.info].join(' · ').slice(0, 500),
        date: target.date,
        url: sectionUrl(target.ref),
        metadata: {
          popular_name: e.name,
          citation: citationOf(target.ref),
          enactments: target.cites,
          notes: target.info,
          match: 'popular_name_table',
        },
      });
    }
    const start = (page - 1) * PER_PAGE;
    return {
      source_id: SOURCE_ID,
      total: results.length,
      page,
      has_more: start + PER_PAGE < results.length,
      results: results.slice(start, start + PER_PAGE),
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const ref = parseDocId(opts.doc_id);
    const section = requireSection(await loadSection(ref), ref);
    // Statutory text first, then the source credit and the OLRC notes (short titles,
    // effective dates, amendments), so truncation drops notes before the law.
    const text = [
      section.heading,
      toText(section.bodyHtml),
      section.sourceCredit,
      section.notes ? `NOTES\n\n${section.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: SOURCE_ID,
      doc_id: docIdOf(ref),
      jurisdiction: 'US',
      type: 'legislation',
      title: section.title,
      text: t.text,
      url: section.url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      version: section.current_through,
      metadata: { citation: citationOf(ref), context: section.context, current_through: section.current_through },
    };
  },

  async findInDocument(opts: FindInDocumentOpts): Promise<FindInDocumentResult> {
    // The "document" is one section; its "articles" are the top-level subsections (a), (b), ...
    const ref = parseDocId(opts.doc_id);
    const section = requireSection(await loadSection(ref), ref);
    const subsections = splitSubsections(section.bodyHtml);
    const terms = opts.keyword.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const matches = subsections
      .filter((s) => {
        const haystack = s.text.toLowerCase();
        return terms.length > 0 && terms.every((t) => haystack.includes(t));
      })
      .slice(0, opts.max_articles ?? 5);
    return {
      source_id: SOURCE_ID,
      doc_id: docIdOf(ref),
      keyword: opts.keyword,
      matches,
      total_articles: subsections.length,
      url: section.url,
    };
  },
};
