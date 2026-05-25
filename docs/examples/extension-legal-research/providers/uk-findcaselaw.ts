// UK/FindCaseLaw — UK judicial decisions via the National Archives'
// "Find Case Law" service (the modern successor to BAILII for many UK
// courts). ATOM feed for search, Akoma Ntoso XML or HTML for full text.

import { fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const BASE = 'https://caselaw.nationalarchives.gov.uk';

interface AtomEntry {
  id: string;
  title: string;
  updated?: string;
  summary?: string;
  uri?: string;
}

function parseAtom(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = [];
  const entryRegex = /<entry\b[\s\S]*?<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[0];
    const id = block.match(/<id[^>]*>([^<]+)<\/id>/i)?.[1] ?? '';
    const title = stripHtml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const updated = block.match(/<updated[^>]*>([^<]+)<\/updated>/i)?.[1];
    const summary = stripHtml(block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? '').slice(0, 500);
    const linkHref = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const uri = linkHref?.replace(/^https?:\/\/caselaw\.nationalarchives\.gov\.uk\//, '');
    entries.push({ id, title, updated, summary, uri });
  }
  return entries;
}

export const ukFindCaseLaw: LegalProvider = {
  source_id: 'UK/FindCaseLaw',
  jurisdiction: 'UK',
  name: 'Find Case Law (UK National Archives)',
  data_types: ['case_law'],
  summary:
    'UK judicial decisions: Supreme Court, Court of Appeal, High Court divisions, Employment Tribunal, etc. Documents identified by URI like "ewhc/ch/2026/694". Each has a Neutral Citation Number (NCN).',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'case_law') {
      return { source_id: 'UK/FindCaseLaw', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const params = new URLSearchParams({ query: opts.query, page: String(page), per_page: '15' });
    if (opts.date_from) params.set('from_date_0', opts.date_from);
    if (opts.date_to) params.set('to_date_0', opts.date_to);
    const xml = await fetchText(`${BASE}/atom.xml?${params.toString()}`, {
      headers: { Accept: 'application/atom+xml' },
    });
    const entries = parseAtom(xml);
    const results: SearchHit[] = entries.map((e) => {
      const uri = e.uri ?? '';
      return {
        source_id: 'UK/FindCaseLaw',
        doc_id: uri,
        jurisdiction: 'UK',
        type: 'case_law',
        title: e.title || uri,
        snippet: e.summary,
        date: e.updated,
        url: `${BASE}/${uri}`,
        metadata: { uri },
      };
    });
    return { source_id: 'UK/FindCaseLaw', page, has_more: results.length >= 15, results };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const url = `${BASE}/${opts.doc_id}`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'UK/FindCaseLaw',
      doc_id: opts.doc_id,
      jurisdiction: 'UK',
      type: 'case_law',
      title: opts.doc_id,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
    };
  },
};
