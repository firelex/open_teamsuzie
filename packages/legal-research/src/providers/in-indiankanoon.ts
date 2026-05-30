// IN/IndianKanoon — Indian case law + statutes via the Indian Kanoon API.
//
// Search: POST https://api.indiankanoon.org/search/  (form-encoded
//   formInput=<query>, optional pagenum, doctypes filter). JSON response.
// Fetch:  POST https://api.indiankanoon.org/doc/{tid}/  → JSON with
//   metadata + cleaned HTML body.
//
// Auth: `Authorization: Token <key>` — free-tier requires registration at
// https://api.indiankanoon.org/. We env-gate the provider; without a key
// it isn't registered.

import { stripHtml, truncateText, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const API = 'https://api.indiankanoon.org';

interface BuildOptions {
  apiKey: string;
}

interface SearchResponse {
  docs?: {
    tid: number;
    title?: string;
    headline?: string;
    publishdate?: string;
    docsource?: string;
    docsize?: number;
    citation?: string;
    fragments?: string[];
  }[];
  found?: string;
  encodedformInput?: string;
}

interface DocResponse {
  tid?: number;
  title?: string;
  doc?: string; // HTML body
  publishdate?: string;
  docsource?: string;
  citetid?: number;
  numcitedby?: number;
  numcites?: number;
}

export function buildInIndianKanoon(opts: BuildOptions): LegalProvider {
  const headers: Record<string, string> = {
    Authorization: `Token ${opts.apiKey}`,
    Accept: 'application/json',
  };

  async function postForm(path: string, body: Record<string, string>): Promise<any> {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`IndianKanoon ${path} ${r.status}: ${text.slice(0, 300)}`);
    }
    return r.json();
  }

  return {
    source_id: 'IN/IndianKanoon',
    jurisdiction: 'IN',
    name: 'Indian Kanoon (India — case law + statutes)',
    data_types: ['legislation', 'case_law'],
    summary:
      'Indian Supreme Court and High Court judgments + central acts via Indian Kanoon. Search supports phrase queries and the "doctypes:" Lucene-ish filter (e.g. "doctypes:supremecourt"). doc_id is the Kanoon tid (an integer). English.',

    async search(opts: SearchOpts): Promise<SearchResults> {
      const page = opts.page ?? 1;
      // Indian Kanoon doctypes filter: "judgments" covers all courts;
      // "supremecourt", "delhi", "kerala", etc. for specific courts;
      // "centralacts" for legislation. Combine with the user query.
      let formInput = opts.query;
      if (opts.type === 'legislation') {
        formInput = `${formInput} doctypes:centralacts`;
      } else if (opts.type === 'case_law') {
        formInput = `${formInput} doctypes:judgments`;
      }
      if (opts.date_from) formInput = `${formInput} fromdate:${opts.date_from.replace(/-/g, '-')}`;
      if (opts.date_to) formInput = `${formInput} todate:${opts.date_to.replace(/-/g, '-')}`;

      const data = (await postForm('/search/', {
        formInput,
        pagenum: String(page - 1),
      })) as SearchResponse;

      const totalMatch = data.found?.match(/(\d+)/);
      const total = totalMatch ? parseInt(totalMatch[1], 10) : undefined;
      const results: SearchHit[] = (data.docs ?? []).map((d) => {
        // Heuristic: tid namespace differs for case law vs central acts.
        // Indian Kanoon mixes both — let the model see `docsource` to decide.
        const isAct = (d.docsource ?? '').toLowerCase().includes('central act');
        return {
          source_id: 'IN/IndianKanoon',
          doc_id: String(d.tid),
          jurisdiction: 'IN',
          type: isAct ? 'legislation' : 'case_law',
          title: stripHtml(d.title ?? '').trim(),
          snippet: stripHtml((d.headline ?? d.fragments?.join(' ') ?? '')).slice(0, 500),
          date: d.publishdate,
          url: `https://indiankanoon.org/doc/${d.tid}/`,
          metadata: {
            tid: d.tid,
            citation: d.citation,
            docsource: d.docsource,
            docsize: d.docsize,
          },
        };
      });
      return {
        source_id: 'IN/IndianKanoon',
        total,
        page,
        has_more: results.length >= 10,
        results,
      };
    },

    async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
      const data = (await postForm(`/doc/${opts.doc_id}/`, {})) as DocResponse;
      const text = stripHtml(data.doc ?? '');
      const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
      const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
      const isAct = (data.docsource ?? '').toLowerCase().includes('central act');
      return {
        source_id: 'IN/IndianKanoon',
        doc_id: opts.doc_id,
        jurisdiction: 'IN',
        type: isAct ? 'legislation' : 'case_law',
        title: stripHtml(data.title ?? '').trim() || `Indian Kanoon ${opts.doc_id}`,
        text: t.text,
        date: data.publishdate,
        url: `https://indiankanoon.org/doc/${opts.doc_id}/`,
        full_length_chars: t.full_length_chars,
        truncated: t.truncated,
        metadata: {
          tid: data.tid,
          docsource: data.docsource,
          numcitedby: data.numcitedby,
          numcites: data.numcites,
        },
      };
    },
  };
}
