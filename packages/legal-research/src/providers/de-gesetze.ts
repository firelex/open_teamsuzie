// DE/GesetzeImInternet — German federal legislation, official source.
//
// Two access modes:
//   1. Section lookup (cheap, one HTTP call): doc_id like "BGB:§535" maps
//      to https://www.gesetze-im-internet.de/<slug>/__535.html. Used by
//      legal_get_document and by legal_search when the query is a
//      structured citation ("§ 573 BGB" / "BGB § 573" / etc.).
//   2. Keyword discovery (lazy bulk fetch + in-memory grep): on first
//      keyword query targeting a code, we fetch the per-code xml.zip
//      (~500 KB compressed for BGB → ~2.5 MB XML, ~2,500 sections),
//      inflate it, parse all <norm> blocks, and cache them. Subsequent
//      keyword queries hit the cache.
//
// No upstream search API exists, so the keyword path scans the cached
// section bodies. By default keyword search covers the top ~10 federal
// codes (BGB, StGB, HGB, GG, ZPO, ...). Mention a specific abbreviation
// in the query and we only scan that code.
//
// Single-file zip extraction is hand-rolled with node:zlib so we don't
// need a dep — every gesetze-im-internet zip contains exactly one .xml.

import zlib from 'node:zlib';
import {
  fetchText,
  stripHtml,
  truncateText,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_TEXT_CHARS,
} from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
  FindInDocumentOpts,
  FindInDocumentResult,
} from '../types.js';

const BASE = 'https://www.gesetze-im-internet.de';
const TOC_URL = `${BASE}/gii-toc.xml`;

// Hand-curated map of common German federal codes → URL slugs. The TOC
// has full titles ("Bürgerliches Gesetzbuch") and the slugs in URLs are
// usually the lowercased abbreviation, but a few diverge ("ao_1977" for
// AO, "rvo" for "RVO"); listing them here avoids a slow TOC search at
// startup. Unknown codes fall through to a TOC title-substring match.
const KNOWN_CODES: Record<string, string> = {
  // Civil & commercial
  BGB: 'bgb',
  HGB: 'hgb',
  AktG: 'aktg',
  GmbHG: 'gmbhg',
  GenG: 'geng',
  WEG: 'weg',
  EBV: 'ebv',
  // Criminal
  StGB: 'stgb',
  StPO: 'stpo',
  OWiG: 'owig',
  // Procedure
  ZPO: 'zpo',
  FamFG: 'famfg',
  VwVfG: 'vwvfg',
  VwGO: 'vwgo',
  FGO: 'fgo',
  SGG: 'sgg',
  ArbGG: 'arbgg',
  // Constitutional
  GG: 'gg',
  BVerfGG: 'bverfgg',
  // Public law / administrative
  GewO: 'gewo',
  AO: 'ao_1977',
  EStG: 'estg',
  KStG: 'kstg',
  UStG: 'ustg_1980',
  // Labor
  KSchG: 'kschg',
  ArbZG: 'arbzg',
  BUrlG: 'burlg',
  TzBfG: 'tzbfg',
  TVG: 'tvg',
  BetrVG: 'betrvg',
  AGG: 'agg',
  EFZG: 'entgfg',
  // Social
  SGB_I: 'sgb_1',
  SGB_II: 'sgb_2',
  SGB_III: 'sgb_3',
  SGB_IV: 'sgb_4',
  SGB_V: 'sgb_5',
  SGB_VI: 'sgb_6',
  SGB_VII: 'sgb_7',
  SGB_VIII: 'sgb_8',
  SGB_IX: 'sgb_9',
  SGB_X: 'sgb_10',
  SGB_XI: 'sgb_11',
  SGB_XII: 'sgb_12',
};

// Default scan list when keyword search has no code hint.
const DEFAULT_SCAN_CODES = ['BGB', 'StGB', 'HGB', 'GG', 'ZPO', 'StPO', 'GewO', 'AO', 'KSchG', 'BetrVG'];

interface CodeSection {
  num: string; // "§ 535", "§ 573c", "Art 1"
  numNorm: string; // normalized for URL: "535", "573c", "1"
  title: string;
  text: string;
}

interface ParsedCode {
  abbr: string;
  slug: string;
  title: string;
  sections: CodeSection[];
  byNum: Map<string, CodeSection>;
}

interface TocEntry {
  title: string;
  slug: string;
}

const codeCache = new Map<string, ParsedCode>();
let tocCache: TocEntry[] | null = null;
let tocLoading: Promise<TocEntry[]> | null = null;

// -- Zip extraction ----------------------------------------------------------
//
// gesetze-im-internet zips each contain exactly one DEFLATEd XML file.
// Parse the local file header, inflate the payload, return as string.
// Spec: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (4.3.7)

function inflateSingleFileZip(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Not a zip local file header (bad signature)');
  }
  const compressionMethod = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const fileNameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataStart = 30 + fileNameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);
  if (compressionMethod === 0) return compressed.toString('utf8');
  if (compressionMethod !== 8) {
    throw new Error(`Unsupported zip compression method ${compressionMethod}`);
  }
  return zlib.inflateRawSync(compressed).toString('utf8');
}

// -- TOC ---------------------------------------------------------------------

async function loadToc(): Promise<TocEntry[]> {
  if (tocCache) return tocCache;
  if (tocLoading) return tocLoading;
  tocLoading = (async () => {
    const xml = await fetchText(TOC_URL);
    const entries: TocEntry[] = [];
    const itemRegex = /<item>\s*<title>([\s\S]*?)<\/title>\s*<link>([^<]+)<\/link>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(xml)) !== null) {
      const title = decodeXmlEntities(m[1].trim());
      const linkUrl = m[2].trim();
      // <link> is "http://www.gesetze-im-internet.de/<slug>/xml.zip"
      const slugMatch = linkUrl.match(/\/([^\/]+)\/xml\.zip$/);
      if (!slugMatch) continue;
      entries.push({ title, slug: slugMatch[1] });
    }
    tocCache = entries;
    tocLoading = null;
    return entries;
  })();
  return tocLoading;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

async function resolveSlug(abbr: string): Promise<string | null> {
  const upper = abbr.toUpperCase();
  if (KNOWN_CODES[upper]) return KNOWN_CODES[upper];
  // Case-insensitive lookup against known map keys
  for (const [key, slug] of Object.entries(KNOWN_CODES)) {
    if (key.toUpperCase() === upper) return slug;
  }
  // Fall back to TOC title substring match (e.g. user passes "Mietrecht" — won't
  // match a code abbrev, so this is a last resort).
  const toc = await loadToc();
  const lower = abbr.toLowerCase();
  const hit = toc.find((e) => e.title.toLowerCase().includes(lower));
  return hit?.slug ?? null;
}

// -- Per-code XML parsing ----------------------------------------------------

function normalizeSectionNum(enbez: string): string {
  // "§ 535" -> "535", "§ 573c" -> "573c", "Art 1" -> "1"
  const m = enbez.match(/(?:§|Art\.?|Artikel)\s*(\d+\s*[a-z]?)/i);
  if (!m) return enbez.replace(/\s+/g, '');
  return m[1].replace(/\s+/g, '').toLowerCase();
}

function parseCodeXml(abbr: string, slug: string, xml: string): ParsedCode {
  const sections: CodeSection[] = [];
  let codeTitle = abbr;
  // Pull law title from the first <langue> element
  const langueMatch = xml.match(/<langue>([^<]+)<\/langue>/);
  if (langueMatch) codeTitle = decodeXmlEntities(langueMatch[1]);

  // Walk individual <norm>...</norm> blocks.
  const normRegex = /<norm\b[\s\S]*?<\/norm>/g;
  let m: RegExpExecArray | null;
  while ((m = normRegex.exec(xml)) !== null) {
    const block = m[0];
    const enbezMatch = block.match(/<enbez>([\s\S]*?)<\/enbez>/);
    if (!enbezMatch) continue; // top-level "Inhaltsübersicht" norm has no enbez
    const num = decodeXmlEntities(enbezMatch[1]).trim();
    const titleMatch = block.match(/<titel[^>]*>([\s\S]*?)<\/titel>/);
    const title = titleMatch ? decodeXmlEntities(stripHtml(titleMatch[1])).trim() : '';
    const contentMatch = block.match(/<Content>([\s\S]*?)<\/Content>/);
    if (!contentMatch) continue;
    const text = decodeXmlEntities(stripHtml(contentMatch[1])).trim();
    if (!text) continue;
    sections.push({ num, numNorm: normalizeSectionNum(num), title, text });
  }

  const byNum = new Map<string, CodeSection>();
  for (const s of sections) byNum.set(s.numNorm, s);

  return { abbr: abbr.toUpperCase(), slug, title: codeTitle, sections, byNum };
}

async function loadCode(abbr: string): Promise<ParsedCode> {
  const upper = abbr.toUpperCase();
  const cached = codeCache.get(upper);
  if (cached) return cached;

  const slug = await resolveSlug(upper);
  if (!slug) {
    throw new Error(`Unknown German code "${abbr}". Known: ${Object.keys(KNOWN_CODES).join(', ')}.`);
  }

  const r = await fetch(`${BASE}/${slug}/xml.zip`, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!r.ok) {
    throw new Error(`gesetze-im-internet ${slug}/xml.zip ${r.status}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const xml = inflateSingleFileZip(buf);
  const parsed = parseCodeXml(upper, slug, xml);
  codeCache.set(upper, parsed);
  return parsed;
}

// -- Citation parsing --------------------------------------------------------
//
// Try to recognize a structured citation in the query so we can do a direct
// section lookup. Patterns:
//   "§ 535 BGB", "§ 573c BGB", "Art 1 GG"
//   "BGB § 535", "BGB §535", "BGB 535"
//   "Section 535 BGB", "BGB Sec 535"

const CITATION_PATTERNS = [
  /(?:§|Art\.?|Artikel|Section|Sec\.?)\s*(\d+\s*[a-z]?)\s+([A-Za-zÄÖÜß_]+)/i,
  /([A-Za-zÄÖÜß_]+)\s*(?:§|Art\.?|Artikel|Section|Sec\.?)\s*(\d+\s*[a-z]?)/i,
];

function parseCitation(query: string): { abbr: string; sectionNum: string } | null {
  const trimmed = query.trim();
  for (const re of CITATION_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    // Decide which capture group is the abbrev — the one that's not all digits.
    const a = m[1].replace(/\s+/g, '');
    const b = m[2].replace(/\s+/g, '');
    if (/^\d+[a-z]?$/i.test(a) && KNOWN_CODES[b.toUpperCase()] !== undefined) {
      return { abbr: b.toUpperCase(), sectionNum: a.toLowerCase() };
    }
    if (/^\d+[a-z]?$/i.test(b) && KNOWN_CODES[a.toUpperCase()] !== undefined) {
      return { abbr: a.toUpperCase(), sectionNum: b.toLowerCase() };
    }
  }
  return null;
}

function detectCodeMention(query: string): string | null {
  // Look for a known code abbreviation as a standalone token.
  const tokens = query.split(/[^A-Za-zÄÖÜß_]+/).filter(Boolean);
  for (const t of tokens) {
    const upper = t.toUpperCase();
    if (KNOWN_CODES[upper]) return upper;
  }
  return null;
}

// -- Section URL ------------------------------------------------------------

function sectionUrl(slug: string, sectionNum: string): string {
  // gesetze-im-internet section URLs are __<num>.html with double underscore.
  return `${BASE}/${slug}/__${sectionNum}.html`;
}

// -- Provider ---------------------------------------------------------------

export const deGesetzeImInternet: LegalProvider = {
  source_id: 'DE/GesetzeImInternet',
  jurisdiction: 'DE',
  name: 'gesetze-im-internet.de (Germany — official federal law)',
  data_types: ['legislation'],
  summary:
    'Official German federal legislation from the Bundesministerium der Justiz. Best for "§ N <CODE>" lookups (e.g. "§ 535 BGB"). Free-text keyword search lazily caches per-code XML and greps section bodies — by default scans the top ~10 codes (BGB, StGB, HGB, GG, ZPO, StPO, etc.); naming a specific code in the query (e.g. "BGB Mietrecht") narrows the scan. doc_id format: "<CODE>:<num>" (e.g. "BGB:535", "BGB:573c").',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'DE/GesetzeImInternet', page: opts.page ?? 1, has_more: false, results: [] };
    }

    // Citation mode: structured "§ N CODE" or "CODE § N"
    const cite = parseCitation(opts.query);
    if (cite) {
      const code = await loadCode(cite.abbr);
      const section = code.byNum.get(cite.sectionNum.toLowerCase());
      if (!section) {
        return {
          source_id: 'DE/GesetzeImInternet',
          page: 1,
          has_more: false,
          results: [],
        };
      }
      return {
        source_id: 'DE/GesetzeImInternet',
        total: 1,
        page: 1,
        has_more: false,
        results: [
          {
            source_id: 'DE/GesetzeImInternet',
            doc_id: `${cite.abbr}:${section.numNorm}`,
            jurisdiction: 'DE',
            type: 'legislation',
            title: `${cite.abbr} ${section.num}${section.title ? ` — ${section.title}` : ''}`,
            snippet: section.text.slice(0, 300),
            url: sectionUrl(code.slug, section.numNorm),
            metadata: { code: cite.abbr, section: section.num, code_title: code.title },
          },
        ],
      };
    }

    // Keyword mode: scan one or more codes' section bodies.
    // Multi-word queries are AND-matched (each term must appear in the
    // section's title or body), since users naturally type phrases like
    // "Kündigungsfrist Mietverhältnis" and the words rarely appear as a
    // single contiguous substring in the statute text.
    const targetAbbr = detectCodeMention(opts.query);
    const targets = targetAbbr ? [targetAbbr] : DEFAULT_SCAN_CODES;
    const remaining = opts.query
      .replace(targetAbbr ? new RegExp(`\\b${targetAbbr}\\b`, 'gi') : /^$/, '')
      .trim()
      .toLowerCase();
    const terms = remaining.split(/\s+/).filter((t) => t.length >= 3);

    if (terms.length === 0) {
      return { source_id: 'DE/GesetzeImInternet', page: 1, has_more: false, results: [] };
    }

    const hits: SearchHit[] = [];
    const errors: string[] = [];
    for (const abbr of targets) {
      let code: ParsedCode;
      try {
        code = await loadCode(abbr);
      } catch (err) {
        errors.push(`${abbr}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const s of code.sections) {
        const haystack = `${s.title}\n${s.text}`.toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) continue;
        // Snippet centered on the first term occurrence
        const idx = haystack.indexOf(terms[0]);
        const snippetStart = Math.max(0, idx - 60);
        const snippet = (s.title ? `${s.title} — ` : '') + s.text.slice(snippetStart, snippetStart + 240);
        hits.push({
          source_id: 'DE/GesetzeImInternet',
          doc_id: `${abbr}:${s.numNorm}`,
          jurisdiction: 'DE',
          type: 'legislation',
          title: `${abbr} ${s.num}${s.title ? ` — ${s.title}` : ''}`,
          snippet,
          url: sectionUrl(code.slug, s.numNorm),
          metadata: { code: abbr, section: s.num, code_title: code.title },
        });
        if (hits.length >= 20) break;
      }
      if (hits.length >= 20) break;
    }

    return {
      source_id: 'DE/GesetzeImInternet',
      total: hits.length,
      page: 1,
      has_more: false,
      results: hits,
      ...(errors.length > 0 ? { errors } : {}),
    } as SearchResults;
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // Expect doc_id = "<CODE>:<num>", e.g. "BGB:535".
    const colon = opts.doc_id.indexOf(':');
    if (colon < 0) {
      throw new Error(`Invalid doc_id "${opts.doc_id}". Expected "<CODE>:<num>" e.g. "BGB:535".`);
    }
    const abbr = opts.doc_id.slice(0, colon).toUpperCase();
    const num = opts.doc_id.slice(colon + 1).toLowerCase().replace(/^§\s*/, '').replace(/\s+/g, '');

    // Prefer cache if loaded — saves a round-trip and gives us the title.
    const cached = codeCache.get(abbr);
    if (cached) {
      const s = cached.byNum.get(num);
      if (s) {
        const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
        const t = opts.truncate !== false ? truncateText(s.text, max) : { text: s.text, truncated: false, full_length_chars: s.text.length };
        return {
          source_id: 'DE/GesetzeImInternet',
          doc_id: opts.doc_id,
          jurisdiction: 'DE',
          type: 'legislation',
          title: `${abbr} ${s.num}${s.title ? ` — ${s.title}` : ''}`,
          text: t.text,
          url: sectionUrl(cached.slug, num),
          full_length_chars: t.full_length_chars,
          truncated: t.truncated,
          metadata: { code: abbr, section: s.num, code_title: cached.title },
        };
      }
    }

    // Otherwise direct HTML fetch — single round-trip, no full code load.
    const slug = await resolveSlug(abbr);
    if (!slug) throw new Error(`Unknown German code "${abbr}".`);
    const url = sectionUrl(slug, num);
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'DE/GesetzeImInternet',
      doc_id: opts.doc_id,
      jurisdiction: 'DE',
      type: 'legislation',
      title: `${abbr} § ${num}`,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { code: abbr, section: `§ ${num}` },
    };
  },

  async findInDocument(opts: FindInDocumentOpts): Promise<FindInDocumentResult> {
    // doc_id is "<CODE>:<num>" — but findInDocument is meant to scope to a
    // whole document. For our purposes, treat the CODE as the document and
    // the keyword search within that code's sections.
    const colon = opts.doc_id.indexOf(':');
    const abbr = colon >= 0 ? opts.doc_id.slice(0, colon).toUpperCase() : opts.doc_id.toUpperCase();
    const code = await loadCode(abbr);
    const terms = opts.keyword.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const matches = code.sections
      .filter((s) => {
        const haystack = `${s.title}\n${s.text}`.toLowerCase();
        return terms.length > 0 && terms.every((t) => haystack.includes(t));
      })
      .slice(0, opts.max_articles ?? 5)
      .map((s) => ({
        article_number: s.num,
        text: (s.title ? `${s.title}\n` : '') + s.text,
      }));
    return {
      source_id: 'DE/GesetzeImInternet',
      doc_id: abbr,
      keyword: opts.keyword,
      matches,
      total_articles: code.sections.length,
      url: `${BASE}/${code.slug}/`,
    };
  },
};
