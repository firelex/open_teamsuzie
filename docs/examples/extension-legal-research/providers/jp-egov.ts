// JP/eGov — Japanese national laws via the e-Gov elaws API.
//
// Search: GET https://elaws.e-gov.go.jp/api/1/lawlists/{category} → XML
//   listing all laws in that category. We cache the union of categories
//   1+2+3+4 at startup-on-demand and post-filter by LawName.
//   - Category 1: Constitution + six main codes (民法, 刑法, 商法, …)
//   - Category 2: ministry-issued laws (政令)
//   - Category 3: cabinet orders (勅令)
//   - Category 4: rules / regulations (省令)
// Fetch:  GET https://elaws.e-gov.go.jp/api/1/lawdata/{LawId} → full XML
//   with body in <LawFullText>.
//
// Japanese language only — the e-Gov API does not provide English text.

import { fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const API = 'https://elaws.e-gov.go.jp/api/1';
const VIEWER = 'https://laws.e-gov.go.jp/law';

interface LawEntry {
  law_id: string;
  law_name: string;
  law_no?: string;
  promulgation_date?: string; // YYYYMMDD
  category: number;
}

let listCache: LawEntry[] | null = null;
let listLoading: Promise<LawEntry[]> | null = null;

function parseLawList(xml: string, category: number): LawEntry[] {
  const out: LawEntry[] = [];
  const blockRegex = /<LawNameListInfo>([\s\S]*?)<\/LawNameListInfo>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(xml)) !== null) {
    const block = m[1];
    const law_id = block.match(/<LawId>([^<]+)<\/LawId>/)?.[1];
    const law_name = block.match(/<LawName>([^<]+)<\/LawName>/)?.[1];
    if (!law_id || !law_name) continue;
    const law_no = block.match(/<LawNo>([^<]+)<\/LawNo>/)?.[1];
    const promulgation_date = block.match(/<PromulgationDate>([^<]+)<\/PromulgationDate>/)?.[1];
    out.push({ law_id, law_name, law_no, promulgation_date, category });
  }
  return out;
}

async function loadAllCategories(): Promise<LawEntry[]> {
  if (listCache) return listCache;
  if (listLoading) return listLoading;
  listLoading = (async () => {
    const all: LawEntry[] = [];
    // Categories 1-4 cover Constitution + Acts + Cabinet orders + Ministerial regs.
    for (const cat of [1, 2, 3, 4]) {
      try {
        const xml = await fetchText(`${API}/lawlists/${cat}`);
        all.push(...parseLawList(xml, cat));
      } catch {
        /* skip categories that error */
      }
    }
    listCache = all;
    listLoading = null;
    return all;
  })();
  return listLoading;
}

function formatPromulgationDate(d?: string): string | undefined {
  if (!d || d.length !== 8) return undefined;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export const jpEGov: LegalProvider = {
  source_id: 'JP/eGov',
  jurisdiction: 'JP',
  name: 'e-Gov 法令検索 (Japan — national laws)',
  data_types: ['legislation'],
  summary:
    'Japanese national laws (constitution, codes, cabinet orders, ministerial regulations) via the official e-Gov elaws API. Search filters law names by keyword (Japanese; AND on terms ≥1 char). doc_id is the LawId (e.g. "129AC0000000089" = Meiji 29 Act #89 = 民法/Civil Code). All text in Japanese.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'JP/eGov', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const all = await loadAllCategories();
    // For Japanese terms we don't enforce a minimum length (CJK characters
    // carry meaning per glyph). Split on whitespace + common punctuation.
    const terms = opts.query.split(/[\s、,]+/).filter(Boolean).map((t) => t.toLowerCase());
    const matches = terms.length === 0
      ? all.slice(0, 20)
      : all.filter((e) => {
          const hay = e.law_name.toLowerCase();
          return terms.every((t) => hay.includes(t));
        });
    const page = opts.page ?? 1;
    const limit = 15;
    const slice = matches.slice((page - 1) * limit, page * limit);
    const results: SearchHit[] = slice.map((e) => ({
      source_id: 'JP/eGov',
      doc_id: e.law_id,
      jurisdiction: 'JP',
      type: 'legislation',
      title: `${e.law_name}${e.law_no ? ` (${e.law_no})` : ''}`,
      date: formatPromulgationDate(e.promulgation_date),
      url: `${VIEWER}/${e.law_id}`,
      metadata: { law_id: e.law_id, law_no: e.law_no, category: e.category },
    }));
    return {
      source_id: 'JP/eGov',
      total: matches.length,
      page,
      has_more: page * limit < matches.length,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const xml = await fetchText(`${API}/lawdata/${opts.doc_id}`);
    // Verify the API returned content (it returns Code=1 + empty body when
    // the LawId isn't found).
    if (/<Code>1<\/Code>/.test(xml)) {
      throw new Error(`JP/eGov: LawId "${opts.doc_id}" not found.`);
    }
    const text = stripHtml(xml);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    const titleMatch = xml.match(/<LawTitle[^>]*>([^<]+)<\/LawTitle>/);
    return {
      source_id: 'JP/eGov',
      doc_id: opts.doc_id,
      jurisdiction: 'JP',
      type: 'legislation',
      title: titleMatch ? titleMatch[1] : opts.doc_id,
      text: t.text,
      url: `${VIEWER}/${opts.doc_id}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { law_id: opts.doc_id },
    };
  },
};
