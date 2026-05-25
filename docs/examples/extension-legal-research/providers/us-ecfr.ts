// US/CFR — Code of Federal Regulations via the eCFR public API.
//
// Search: GET /api/search/v1/results?query=&per_page= → JSON
// Fetch:  GET /api/versioner/v1/full/{issue_date}/title-{N}.xml?...{hierarchy} → XML
//
// Each title has its own `up_to_date_as_of` issue date (typically a few days
// behind today). We fetch the title list once and cache the per-title issue
// date so getDocument doesn't 404 against a too-recent default.

import {
  fetchJson,
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

const API = 'https://www.ecfr.gov/api';
const VIEWER = 'https://www.ecfr.gov/current';

interface SearchResultItem {
  starts_on?: string;
  ends_on?: string | null;
  type?: string;
  hierarchy?: Record<string, string | null>;
  hierarchy_headings?: Record<string, string | null>;
  headings?: Record<string, string | null>;
  full_text_excerpt?: string;
  score?: number;
}

interface TitleEntry {
  number: number;
  name: string;
  up_to_date_as_of?: string;
  latest_issue_date?: string;
  reserved?: boolean;
}

let titlesCache: Map<number, TitleEntry> | null = null;
let titlesLoading: Promise<Map<number, TitleEntry>> | null = null;

async function loadTitles(): Promise<Map<number, TitleEntry>> {
  if (titlesCache) return titlesCache;
  if (titlesLoading) return titlesLoading;
  titlesLoading = (async () => {
    const data = await fetchJson<{ titles: TitleEntry[] }>(`${API}/versioner/v1/titles`);
    const map = new Map<number, TitleEntry>();
    for (const t of data.titles ?? []) map.set(t.number, t);
    titlesCache = map;
    titlesLoading = null;
    return map;
  })();
  return titlesLoading;
}

function buildDocId(h: Record<string, string | null> | undefined): string | null {
  if (!h) return null;
  // Compose stable id from non-null hierarchy parts. Always lead with title;
  // include the deepest available level as the leaf.
  const parts: string[] = [];
  for (const k of ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'subject_group', 'section', 'appendix']) {
    const v = h[k];
    if (v != null && v !== '') parts.push(`${k}=${v}`);
  }
  return parts.length === 0 ? null : parts.join('|');
}

function parseDocId(docId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of docId.split('|')) {
    const [k, v] = piece.split('=');
    if (k && v) out[k] = v;
  }
  return out;
}

function buildHierarchyQuery(h: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const k of ['subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'subject_group', 'section', 'appendix']) {
    if (h[k]) params.set(k, h[k]);
  }
  return params.toString();
}

function citationFromHierarchy(h: Record<string, string | null> | undefined): string {
  if (!h) return '';
  const title = h.title;
  const part = h.part;
  const section = h.section;
  if (title && section) return `${title} CFR ${section}`;
  if (title && part) return `${title} CFR Part ${part}`;
  if (title) return `${title} CFR`;
  return '';
}

function viewerUrl(h: Record<string, string | null> | undefined): string {
  if (!h?.title) return VIEWER;
  const parts = [`title-${h.title}`];
  if (h.chapter) parts.push(`chapter-${h.chapter}`);
  if (h.part) parts.push(`part-${h.part}`);
  if (h.subpart) parts.push(`subpart-${h.subpart}`);
  if (h.section) parts.push(`section-${h.section}`);
  return `${VIEWER}/${parts.join('/')}`;
}

export const usCfr: LegalProvider = {
  source_id: 'US/CFR',
  jurisdiction: 'US',
  name: 'eCFR (US Code of Federal Regulations)',
  data_types: ['legislation'],
  summary:
    'US federal regulations (Title 1–50) via the official eCFR API. Search returns the leading hits with hierarchy metadata; doc_id encodes the hierarchy path so getDocument can fetch the exact section/part XML at the latest issue date.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'US/CFR', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const perPage = 10;
    const params = new URLSearchParams({
      query: opts.query,
      per_page: String(perPage),
      page: String(page),
    });
    if (opts.date_from) params.set('last_modified_after', opts.date_from);
    if (opts.date_to) params.set('last_modified_before', opts.date_to);
    const data = await fetchJson<{ results?: SearchResultItem[]; meta?: { total_count?: number } }>(
      `${API}/search/v1/results?${params.toString()}`,
    );
    const results: SearchHit[] = [];
    for (const r of data.results ?? []) {
      const docId = buildDocId(r.hierarchy);
      if (!docId) continue;
      const citation = citationFromHierarchy(r.hierarchy);
      const headingTitle = r.headings?.section || r.headings?.part || r.headings?.chapter || r.headings?.title || '';
      results.push({
        source_id: 'US/CFR',
        doc_id: docId,
        jurisdiction: 'US',
        type: 'legislation',
        title: [citation, stripHtml(headingTitle)].filter(Boolean).join(' — '),
        snippet: r.full_text_excerpt ? stripHtml(r.full_text_excerpt).slice(0, 500) : undefined,
        date: r.starts_on,
        url: viewerUrl(r.hierarchy),
        metadata: { hierarchy: r.hierarchy, citation, type: r.type, score: r.score },
      });
    }
    return {
      source_id: 'US/CFR',
      total: data.meta?.total_count,
      page,
      has_more: results.length === perPage,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const h = parseDocId(opts.doc_id);
    if (!h.title) {
      throw new Error(`Invalid CFR doc_id "${opts.doc_id}". Expected hierarchy like "title=12|part=1024".`);
    }
    const titles = await loadTitles();
    const titleNum = parseInt(h.title, 10);
    const titleMeta = titles.get(titleNum);
    const issueDate = titleMeta?.up_to_date_as_of ?? titleMeta?.latest_issue_date;
    if (!issueDate) {
      throw new Error(`No issue date known for CFR Title ${titleNum}.`);
    }
    const queryStr = buildHierarchyQuery(h);
    const url = `${API}/versioner/v1/full/${issueDate}/title-${titleNum}.xml${queryStr ? `?${queryStr}` : ''}`;
    const xml = await fetchText(url);
    const text = stripHtml(xml);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'US/CFR',
      doc_id: opts.doc_id,
      jurisdiction: 'US',
      type: 'legislation',
      title: citationFromHierarchy(h) || `Title ${titleNum}`,
      text: t.text,
      date: issueDate,
      url: viewerUrl(h),
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      version: issueDate,
      metadata: { hierarchy: h, xml_url: url, title_name: titleMeta?.name },
    };
  },
};
