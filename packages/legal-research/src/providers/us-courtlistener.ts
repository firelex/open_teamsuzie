// US/CourtListener — federal and state case law via CourtListener REST API v4.
//
// Search hits opinions; getDocument fetches a single opinion's full text.
// Token auth (Authorization: Token <token>) raises rate limits; without it
// we still hit the public unauthenticated tier.
//
// Docs: https://www.courtlistener.com/help/api/rest/

import { DEFAULT_TIMEOUT_MS, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const BASE_URL = 'https://www.courtlistener.com/api/rest/v4';

interface BuildOptions {
  token?: string;
  baseUrl?: string;
}

export function buildUsCourtListener(opts: BuildOptions = {}): LegalProvider {
  const baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/$/, '');
  const token = opts.token?.trim();

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (token) h['Authorization'] = `Token ${token}`;
    return h;
  };

  async function getJson(url: string): Promise<any> {
    const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`CourtListener ${r.status}: ${text.slice(0, 300)}`);
    }
    return r.json();
  }

  return {
    source_id: 'US/CourtListener',
    jurisdiction: 'US',
    name: 'CourtListener (United States)',
    data_types: ['case_law'],
    summary:
      'US federal and state case law (judicial opinions) via CourtListener. Best for finding decisions, holdings, citations. Tip: query supports phrase + AND/OR; metadata can include `court` (e.g. "ca9", "scotus") and date filters.',

    async search(opts: SearchOpts): Promise<SearchResults> {
      // CourtListener has many search types; legislation is not one of them. If
      // the caller insisted on legislation, return empty rather than mislead.
      if (opts.type && opts.type !== 'case_law') {
        return { source_id: 'US/CourtListener', page: opts.page ?? 1, has_more: false, results: [] };
      }

      const params = new URLSearchParams({ q: opts.query, type: 'o' });
      if (opts.date_from) params.set('filed_after', opts.date_from);
      if (opts.date_to) params.set('filed_before', opts.date_to);
      params.set('page_size', '10');

      const data = await getJson(`${baseUrl}/search/?${params.toString()}`);
      const total = typeof data.count === 'number' ? data.count : undefined;
      const results: SearchHit[] = (data.results ?? []).map((r: any) => {
        const path = r.absolute_url as string | undefined;
        const url = path ? `https://www.courtlistener.com${path}` : `https://www.courtlistener.com/opinion/${r.cluster_id}/`;
        return {
          source_id: 'US/CourtListener',
          // We need an ID that round-trips into getDocument — opinion id is the
          // canonical fetchable document. Search returns one row per opinion.
          doc_id: String(r.id),
          jurisdiction: 'US',
          type: 'case_law',
          title: String(r.caseName ?? r.case_name ?? `Opinion ${r.id}`),
          snippet: typeof r.snippet === 'string' ? r.snippet.slice(0, 500) : undefined,
          date: r.dateFiled ?? r.date_filed,
          url,
          metadata: {
            cluster_id: r.cluster_id,
            court: r.court,
            court_id: r.court_id,
            citation: r.citation,
            judge: r.judge,
            status: r.status,
          },
        };
      });

      return {
        source_id: 'US/CourtListener',
        total,
        page: opts.page ?? 1,
        has_more: typeof data.next === 'string' && data.next.length > 0,
        results,
      };
    },

    async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
      const data = await getJson(`${baseUrl}/opinions/${opts.doc_id}/`);
      const text = (data.plain_text as string) || (data.html as string) || '';
      const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
      const trimmed = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
      const path = data.absolute_url as string | undefined;
      const url = path ? `https://www.courtlistener.com${path}` : `https://www.courtlistener.com/opinion/${data.cluster}/`;

      return {
        source_id: 'US/CourtListener',
        doc_id: opts.doc_id,
        jurisdiction: 'US',
        type: 'case_law',
        title: `Opinion ${data.id}`,
        text: trimmed.text,
        url,
        full_length_chars: trimmed.full_length_chars,
        truncated: trimmed.truncated,
        metadata: {
          cluster: data.cluster,
          author: data.author,
          type: data.type,
          per_curiam: data.per_curiam,
          page_count: data.page_count,
          download_url: data.download_url,
        },
      };
    },
  };
}
