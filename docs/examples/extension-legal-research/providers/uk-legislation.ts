// UK/Legislation — UK statutes (Public General Acts, Statutory Instruments,
// devolved legislation) via legislation.gov.uk.
//
// Search uses the public ATOM feed with `title=<query>`; doc fetch hits
// the canonical /id endpoint and parses HTML to plain text.

import { fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const BASE = 'https://www.legislation.gov.uk';

interface AtomEntry {
  id: string;
  title: string;
  updated?: string;
  summary?: string;
  htmlUrl?: string;
}

function parseAtom(xml: string): { entries: AtomEntry[]; total?: number } {
  const entries: AtomEntry[] = [];
  const totalMatch = xml.match(/<openSearch:totalResults[^>]*>(\d+)</i);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : undefined;

  const entryRegex = /<entry\b[\s\S]*?<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[0];
    const id =
      block.match(/<id[^>]*>([^<]+)<\/id>/i)?.[1] ??
      block.match(/<link[^>]*rel=["']self["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
      '';
    const title = stripHtml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const updated = block.match(/<updated[^>]*>([^<]+)<\/updated>/i)?.[1];
    const summary = stripHtml(block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? '').slice(0, 500);
    const htmlUrl = block.match(/<link[^>]*type=["']text\/html["'][^>]*href=["']([^"']+)["']/i)?.[1];
    entries.push({ id, title, updated, summary, htmlUrl });
  }
  return { entries, total };
}

function pathFromId(idUrl: string): string {
  // Convert "https://www.legislation.gov.uk/id/ukpga/1998/29" → "ukpga/1998/29".
  return idUrl.replace(/^https?:\/\/www\.legislation\.gov\.uk\/(id\/)?/, '').replace(/\/$/, '');
}

export const ukLegislation: LegalProvider = {
  source_id: 'UK/Legislation',
  jurisdiction: 'UK',
  name: 'legislation.gov.uk (United Kingdom)',
  data_types: ['legislation'],
  summary:
    'UK statutes — Public General Acts (ukpga), Statutory Instruments (uksi), devolved (asp/wsi/nia/nisi). Documents identified by short paths like "ukpga/1998/29" (Data Protection Act 1998).',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'UK/Legislation', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const params = new URLSearchParams({ title: opts.query, page: String(page) });
    const xml = await fetchText(`${BASE}/all/data.feed?${params.toString()}`, {
      headers: { Accept: 'application/atom+xml' },
    });
    const { entries, total } = parseAtom(xml);
    const results: SearchHit[] = entries.map((e) => {
      const path = pathFromId(e.id);
      return {
        source_id: 'UK/Legislation',
        doc_id: path,
        jurisdiction: 'UK',
        type: 'legislation',
        title: e.title || path,
        snippet: e.summary,
        date: e.updated,
        url: `${BASE}/${path}`,
        metadata: { feed_id: e.id },
      };
    });
    return {
      source_id: 'UK/Legislation',
      total,
      page,
      has_more: total ? page * 20 < total : results.length >= 20,
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // Fetch the rendered HTML; the /data.xml form is Akoma Ntoso and harder
    // to convert cleanly without an XML parser.
    const url = `${BASE}/${opts.doc_id}`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'UK/Legislation',
      doc_id: opts.doc_id,
      jurisdiction: 'UK',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
    };
  },
};
