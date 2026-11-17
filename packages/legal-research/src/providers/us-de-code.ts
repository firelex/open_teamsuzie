// US-DE/Code — the Delaware Code (state statutes) via Delaware Code Online,
// published by the Division of Legislative Services (delcode.delaware.gov).
// The site calls its text "an official version of the State of Delaware
// statutory code"; it carries a no-warranty disclaimer and has no robots.txt.
//
// The site is a tree of static HTML pages:
//   /title8/index.html                -> chapters of a title ("title-links")
//   /title8/c001/index.html           -> subchapters of a chapter ("title-links"), or
//   /title8/c005/index.html           -> a leaf page: a list of its sections
//                                        (<ul class="chaptersections">) and their text
//   /title8/c001/sc08/index.html      -> a leaf page for a subchapter
// Each section sits in <div class="Section"> with <div class="SectionHead" id="242">.
//
// There is no search API we use, so search works two ways:
//   1. By citation: "8 Del. C. § 242", "Del. Code Ann. tit. 8, § 242",
//      "Title 8 section 502", "DGCL 275", "6 Del. C. § 18-101", "DLLCA 18-101".
//      The section is found by walking the title's index pages at runtime: the
//      chapter guessed from the section number first (Delaware sections in
//      chapter N mostly start at N×100, or carry an "N-" prefix as in Title 6),
//      then its neighbours, up to MAX_CHAPTER_PROBES chapters.
//   2. By keyword in the table of contents: the words must all appear in a
//      title's name, a chapter or subchapter name, or a section heading. Limits:
//      without a title in the query (e.g. "Title 8 appraisal" or "DGCL appraisal"),
//      only title and chapter names across the 31 titles are matched; with a title,
//      subchapter names and section headings are matched too, but in a title of
//      more than SMALL_TITLE_CHAPTERS chapters only inside chapters whose own name
//      matches. Section text is never searched (that would mean fetching the whole
//      Code); fetch a hit and use the text.
//
// doc_id format: "title8/s242" for a section (getDocument returns its current
// text); "title8/c001/sc08" for an index or leaf page (getDocument returns the
// page's text: a contents list or every section on it). date_from/date_to are
// ignored: the site holds only the current text.

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

const SOURCE_ID = 'US-DE/Code';
const JURISDICTION = 'US-DE';
const BASE = 'https://delcode.delaware.gov';
const TITLE_COUNT = 31;
/** How many chapters a citation lookup walks before giving up. */
const MAX_CHAPTER_PROBES = 8;
/** Titles with at most this many chapters have every section heading scanned in a keyword search. */
const SMALL_TITLE_CHAPTERS = 12;
const PER_PAGE = 10;
const FETCH_CONCURRENCY = 6;

/** Statute short names lawyers cite instead of the title, mapped to their title. */
const ALIASES: { pattern: RegExp; title: number; name: string }[] = [
  { pattern: /\b(?:DGCL|Delaware General Corporation Law|General Corporation Law)\b/i, title: 8, name: 'General Corporation Law' },
  { pattern: /\b(?:DLLCA|Delaware Limited Liability Company Act|LLC Act)\b/i, title: 6, name: 'Limited Liability Company Act' },
  { pattern: /\b(?:DRULPA|Revised Uniform Limited Partnership Act)\b/i, title: 6, name: 'Revised Uniform Limited Partnership Act' },
  { pattern: /\b(?:DSTA|Delaware Statutory Trust Act|Statutory Trust Act)\b/i, title: 12, name: 'Statutory Trust Act' },
];

// -----------------------------------------------------------------------------
// Index pages
// -----------------------------------------------------------------------------

interface ChildLink {
  /** Path without host or "/index.html", e.g. "title8/c001/sc08". */
  path: string;
  label: string;
}

interface SectionEntry {
  /** As the page writes it, e.g. "242", "18-101", "9-105A". */
  number: string;
  heading: string;
}

interface IndexPage {
  path: string;
  /** The page's own heading, e.g. "GENERAL CORPORATION LAW" or "Corporations". */
  heading: string;
  /** Sub-pages (chapters, subchapters); empty on a leaf page. */
  children: ChildLink[];
  /** Sections printed on the page; empty on a page that only lists sub-pages. */
  sections: SectionEntry[];
}

const pageCache = new Map<string, Promise<IndexPage>>();

function pageUrl(path: string): string {
  return `${BASE}/${path}/index.html`;
}

/** Collapses HTML whitespace runs (the site pretty-prints its markup), then strips tags. */
function cleanText(html: string): string {
  return stripHtml(html.replace(/\s+/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseIndexPage(path: string, html: string): IndexPage {
  const url = pageUrl(path);
  const children: ChildLink[] = [];
  const linkRe = /<div class="title-links">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].replace(/&#xA;/g, '').trim();
    const abs = new URL(href, url);
    const childPath = abs.pathname.replace(/^\//, '').replace(/\/index\.html$/, '');
    children.push({ path: childPath, label: cleanText(m[2]) });
  }

  const sections: SectionEntry[] = [];
  const headRe = /<div class="SectionHead" id="([^"]+)">([\s\S]*?)<\/div>/g;
  while ((m = headRe.exec(html)) !== null) {
    const heading = cleanText(m[2]).replace(/^§\s*/, '§ ');
    sections.push({ number: m[1], heading });
  }

  if (children.length === 0 && sections.length === 0) {
    throw new Error(`Delaware Code page ${url} lists neither sub-pages nor sections; the site layout may have changed.`);
  }
  const h2 = html.match(/<h2>([\s\S]*?)<\/h2>/);
  const h3 = html.match(/<div id="TitleHead">[\s\S]*?<h3>([\s\S]*?)<\/h3>\s*<h4>([\s\S]*?)<\/h4>/);
  const heading = h3
    ? [cleanText(h3[1]), cleanText(h3[2])].filter(Boolean).join(' — ')
    : h2
      ? cleanText(h2[1])
      : path;
  return { path, heading, children, sections };
}

function loadPage(path: string): Promise<IndexPage> {
  const cached = pageCache.get(path);
  if (cached) return cached;
  const loading = fetchText(pageUrl(path)).then(
    (html) => parseIndexPage(path, html),
    (err: unknown) => {
      pageCache.delete(path);
      throw new Error(`Delaware Code page ${pageUrl(path)} could not be fetched: ${(err as Error).message}`);
    },
  );
  pageCache.set(path, loading);
  return loading;
}

/** Every leaf page (one carrying sections) under a page, depth-first in site order. */
async function leafPagesUnder(path: string): Promise<IndexPage[]> {
  const page = await loadPage(path);
  if (page.children.length === 0) return [page];
  const nested = await mapLimit(page.children, FETCH_CONCURRENCY, (c) => leafPagesUnder(c.path));
  return nested.flat();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// -----------------------------------------------------------------------------
// Citations
// -----------------------------------------------------------------------------

interface Citation {
  title: number;
  /** As written in the query, e.g. "242", "18-101", "9-105A". */
  section: string;
}

const SECTION = String.raw`(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)`;

function parseCitation(query: string): Citation | null {
  const q = query.replace(/\s+/g, ' ');
  // "8 Del. C. § 242", "8 Del.C. 242(a)", "8 Del. Code § 242"
  let m = q.match(new RegExp(String.raw`\b(\d{1,2})\s*Del\.?\s*(?:C\.?|Code)\s*(?:Ann\.?)?\s*§*\s*` + SECTION, 'i'));
  if (m) return { title: +m[1], section: m[2] };
  // "Del. Code Ann. tit. 8, § 242", "Title 8, section 502", "tit. 8 § 502"
  m = q.match(new RegExp(String.raw`\b(?:title|tit\.?)\s*(\d{1,2})\s*,?\s*(?:§+|sec(?:tion|\.)?s?)\s*` + SECTION, 'i'));
  if (m) return { title: +m[1], section: m[2] };
  // "DGCL 275", "DGCL § 275", "Section 275 of the DGCL", "§ 18-101 of the LLC Act"
  for (const a of ALIASES) {
    if (!a.pattern.test(q)) continue;
    m = q.match(new RegExp(a.pattern.source + String.raw`\s*,?\s*(?:§+|sec(?:tion|\.)?)?\s*` + SECTION, 'i'));
    if (m) return { title: a.title, section: m[1] };
    m = q.match(new RegExp(String.raw`(?:§+|\bsec(?:tion|\.)?)\s*` + SECTION + String.raw`\b[^§]*?` + a.pattern.source, 'i'));
    if (m) return { title: a.title, section: m[1] };
  }
  return null;
}

/** The title a keyword query names, if any ("Title 8 ...", "8 Del. C. ...", "DGCL ..."). */
function titleNamedIn(query: string): number | null {
  const m = query.match(/\b(?:title|tit\.?)\s*(\d{1,2})\b/i) ?? query.match(/\b(\d{1,2})\s*Del\.?\s*(?:C\.?|Code)\b/i);
  if (m) return +m[1];
  for (const a of ALIASES) if (a.pattern.test(query)) return a.title;
  return null;
}

/** Chapter number from a path segment: "c001" -> 1, "c002a" -> 2, "c012_1" -> 12. */
function chapterNumber(path: string): number {
  const m = path.match(/\/c(\d+)/);
  if (!m) throw new Error(`Unexpected Delaware Code chapter path "${path}".`);
  return parseInt(m[1], 10);
}

/** The chapters of a title, in the order a section lookup should walk them. */
function probeOrder(chapters: ChildLink[], section: string): ChildLink[] {
  const hyphen = section.match(/^(\d+)([A-Za-z]?)-/);
  let guess: number;
  if (hyphen) {
    // Title 6 style: "18-101" is in chapter 18, "2A-101" in chapter 2A.
    const exact = chapters.find((c) => c.path.endsWith(`/c${hyphen[1].padStart(3, '0')}${hyphen[2].toLowerCase()}`));
    if (exact) return [exact, ...chapters.filter((c) => c !== exact)];
    guess = parseInt(hyphen[1], 10);
  } else {
    // Sections of chapter N mostly start at N×100 (Title 12 § 3801 is in chapter 38);
    // Title 8 is looser (§§ 101–398 are all chapter 1), so take the highest chapter
    // whose N×100 does not exceed the section number.
    const n = parseInt(section, 10);
    const below = chapters.map((c) => chapterNumber(c.path)).filter((c) => c * 100 <= n);
    guess = below.length > 0 ? Math.max(...below) : chapterNumber(chapters[0].path);
  }
  return [...chapters].sort((a, b) => {
    const da = chapterNumber(a.path) - guess;
    const db = chapterNumber(b.path) - guess;
    // Same distance: prefer the lower chapter (a section is never before its chapter's start).
    return Math.abs(da) - Math.abs(db) || da - db;
  });
}

interface Located {
  leaf: IndexPage;
  entry: SectionEntry;
}

async function locateSection(c: Citation): Promise<Located> {
  if (c.title < 1 || c.title > TITLE_COUNT) {
    throw new Error(`Delaware Code has titles 1 to ${TITLE_COUNT}; got title ${c.title}.`);
  }
  const title = await loadPage(`title${c.title}`);
  const want = c.section.toUpperCase();
  const probes = probeOrder(title.children, c.section).slice(0, MAX_CHAPTER_PROBES);
  for (const chapter of probes) {
    for (const leaf of await leafPagesUnder(chapter.path)) {
      const entry = leaf.sections.find((s) => s.number.toUpperCase() === want);
      if (entry) return { leaf, entry };
    }
  }
  throw new Error(
    `Section ${c.section} was not found in Title ${c.title} of the Delaware Code (looked in ${probes
      .map((p) => p.label)
      .join('; ')}). Check the citation, or browse ${pageUrl(`title${c.title}`)}.`,
  );
}

// -----------------------------------------------------------------------------
// Keyword search in the table of contents
// -----------------------------------------------------------------------------

const STOPWORDS = new Set(['the', 'of', 'and', 'or', 'a', 'an', 'in', 'on', 'for', 'to', 'by', 'del', 'c', 'code', 'delaware', 'title', 'tit', 'section', 'sec', 'chapter']);

function keywords(query: string): string[] {
  let q = query;
  for (const a of ALIASES) q = q.replace(a.pattern, ' ');
  q = q.replace(/\b(?:title|tit\.?)\s*\d{1,2}\b/gi, ' ').replace(/\b\d{1,2}\s*Del\.?\s*(?:C\.?|Code)\b/gi, ' ');
  return [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w)))];
}

function matchesAll(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

interface TocHit {
  title: number;
  path: string;
  /** Set for a section hit. */
  section?: string;
  label: string;
  context: string;
}

/** The currency line on the home page, e.g. "October 01, 2026 (85 Del. Laws, c. 550)". */
async function loadCurrency(): Promise<string> {
  const html = await fetchText(`${BASE}/`);
  const m = html.match(/includes all acts enacted as of ([A-Z][a-z]+ \d{1,2}, \d{4})(?:, up to and including (\d+ Del\. Laws, c\. \d+))?/);
  if (!m) {
    throw new Error(`The Delaware Code Online home page (${BASE}/) no longer states which acts it includes; the site layout may have changed.`);
  }
  return m[2] ? `${m[1]} (${m[2]})` : m[1];
}

let currencyCache: Promise<string> | null = null;
function currency(): Promise<string> {
  if (!currencyCache) {
    currencyCache = loadCurrency().catch((err: unknown) => {
      currencyCache = null;
      throw err;
    });
  }
  return currencyCache;
}

async function searchToc(words: string[], onlyTitle: number | null): Promise<TocHit[]> {
  const hits: TocHit[] = [];
  const titleNums = onlyTitle ? [onlyTitle] : Array.from({ length: TITLE_COUNT }, (_, i) => i + 1);
  const titles = await mapLimit(titleNums, FETCH_CONCURRENCY, (n) => loadPage(`title${n}`));

  for (const [i, t] of titles.entries()) {
    const n = titleNums[i];
    if (matchesAll(t.heading, words)) {
      hits.push({ title: n, path: t.path, label: `Title ${n}. ${t.heading}`, context: `Title ${n}` });
    }
    for (const ch of t.children) {
      if (matchesAll(`${t.heading} ${ch.label}`, words)) {
        hits.push({ title: n, path: ch.path, label: ch.label, context: `Title ${n}. ${t.heading}` });
      }
    }
  }
  if (!onlyTitle) return hits;

  // One title: go down to subchapters and section headings.
  const title = titles[0];
  const chapters =
    title.children.length <= SMALL_TITLE_CHAPTERS
      ? title.children
      : title.children.filter((ch) => words.some((w) => ch.label.toLowerCase().includes(w)));
  for (const ch of chapters) {
    const chapterPage = await loadPage(ch.path);
    for (const sub of chapterPage.children) {
      if (matchesAll(sub.label, words)) {
        hits.push({ title: onlyTitle, path: sub.path, label: sub.label, context: `Title ${onlyTitle}, ${ch.label}` });
      }
    }
    for (const leaf of await leafPagesUnder(ch.path)) {
      for (const s of leaf.sections) {
        if (matchesAll(s.heading, words)) {
          hits.push({ title: onlyTitle, path: leaf.path, section: s.number, label: s.heading, context: `Title ${onlyTitle}, ${leaf.heading}` });
        }
      }
    }
  }
  return hits;
}

// -----------------------------------------------------------------------------
// Section text
// -----------------------------------------------------------------------------

/** The HTML of one <div class="Section"> on a leaf page. */
function sectionHtml(pageHtml: string, number: string, url: string): string {
  const marker = `<div class="SectionHead" id="${number}">`;
  const at = pageHtml.indexOf(marker);
  if (at < 0) throw new Error(`Section ${number} is not on ${url}; the site layout may have changed.`);
  const start = pageHtml.lastIndexOf('<div class="Section">', at);
  const nextSection = pageHtml.indexOf('<div class="Section">', at);
  const footer = pageHtml.indexOf('<footer', at);
  const end = nextSection >= 0 ? nextSection : footer;
  if (start < 0 || end < 0) throw new Error(`Could not cut section ${number} out of ${url}; the site layout may have changed.`);
  return pageHtml.slice(start, end);
}

function sectionDocId(title: number, section: string): string {
  return `title${title}/s${section}`;
}

function citationLabel(title: number, section: string): string {
  return `${title} Del. C. § ${section}`;
}

export const usDeCode: LegalProvider = {
  source_id: SOURCE_ID,
  jurisdiction: JURISDICTION,
  name: 'Delaware Code Online (Delaware statutes)',
  data_types: ['legislation'],
  summary:
    'The Delaware Code, current text, from the official Delaware Code Online (Title 8 holds the General Corporation Law in chapter 1 and the franchise tax in chapter 5; Title 6 the LLC and partnership Acts; Title 12 the Statutory Trust Act). No full-text search: query by citation ("8 Del. C. § 242", "DGCL 275", "Title 8 section 502", "6 Del. C. § 18-101") or by words in the table of contents (name the title, e.g. "DGCL appraisal" or "Title 8 franchise tax", to also match section headings). doc_id "title8/s242" is a section; "title8/c001/sc08" a chapter or subchapter page.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: SOURCE_ID, page, has_more: false, results: [] };
    }

    const c = parseCitation(opts.query);
    if (c) {
      const { leaf, entry } = await locateSection(c);
      return {
        source_id: SOURCE_ID,
        total: 1,
        page: 1,
        has_more: false,
        results: [
          {
            source_id: SOURCE_ID,
            doc_id: sectionDocId(c.title, entry.number),
            jurisdiction: JURISDICTION,
            type: 'legislation',
            title: `${citationLabel(c.title, entry.number)} — ${entry.heading.replace(/^§\s*[^ ]+\.\s*/, '')}`,
            snippet: leaf.heading,
            url: `${pageUrl(leaf.path)}#${entry.number}`,
            metadata: { title: c.title, section: entry.number, page: leaf.path, citation: citationLabel(c.title, entry.number) },
          },
        ],
      };
    }

    const words = keywords(opts.query);
    if (words.length === 0) {
      return { source_id: SOURCE_ID, total: 0, page, has_more: false, results: [] };
    }
    const toc = await searchToc(words, titleNamedIn(opts.query));
    const slice = toc.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const results: SearchHit[] = slice.map((h) => ({
      source_id: SOURCE_ID,
      doc_id: h.section ? sectionDocId(h.title, h.section) : h.path,
      jurisdiction: JURISDICTION,
      type: 'legislation',
      title: h.section ? `${citationLabel(h.title, h.section)} — ${h.label.replace(/^§\s*[^ ]+\.\s*/, '')}` : `${h.context} — ${h.label}`,
      snippet: h.context,
      url: h.section ? `${pageUrl(h.path)}#${h.section}` : pageUrl(h.path),
      metadata: { title: h.title, page: h.path, section: h.section },
    }));
    return { source_id: SOURCE_ID, total: toc.length, page, has_more: page * PER_PAGE < toc.length, results };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const sec = opts.doc_id.match(/^title(\d{1,2})\/s(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)$/);
    const pg = opts.doc_id.match(/^title(\d{1,2})(?:\/[a-z0-9_]+)*$/);
    if (!sec && !pg) {
      throw new Error(`Invalid Delaware Code doc_id "${opts.doc_id}". Expected "title8/s242" (a section) or "title8/c001/sc08" (a page).`);
    }
    const asOf = await currency();

    let url: string;
    let title: string;
    let text: string;
    let metadata: Record<string, unknown>;
    if (sec) {
      const c: Citation = { title: +sec[1], section: sec[2] };
      const { leaf, entry } = await locateSection(c);
      const leafUrl = pageUrl(leaf.path);
      const html = await fetchText(leafUrl);
      text = cleanText(sectionHtml(html, entry.number, leafUrl));
      url = `${leafUrl}#${entry.number}`;
      title = `${citationLabel(c.title, entry.number)} — ${entry.heading.replace(/^§\s*[^ ]+\.\s*/, '')}`;
      metadata = { title: c.title, section: entry.number, page: leaf.path, part_of: leaf.heading, citation: citationLabel(c.title, entry.number) };
    } else {
      url = pageUrl(opts.doc_id);
      const html = await fetchText(url);
      const parsed = parseIndexPage(opts.doc_id, html);
      const body = html.match(/<div id="CodeBody">([\s\S]*?)<footer/);
      text = body
        ? cleanText(body[1])
        : parsed.children.map((ch) => `${ch.label} [doc_id ${ch.path}]`).join('\n');
      title = `Delaware Code, Title ${pg![1]} — ${parsed.heading}`;
      metadata = { title: +pg![1], page: opts.doc_id, sections: parsed.sections.map((s) => s.number), children: parsed.children };
    }

    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: SOURCE_ID,
      doc_id: opts.doc_id,
      jurisdiction: JURISDICTION,
      type: 'legislation',
      title,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      version: `Current through acts enacted as of ${asOf}`,
      metadata,
    };
  },
};
