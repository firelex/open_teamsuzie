// DE/OpenLegalData — German federal + state legislation and case law via
// the de.openlegaldata.io REST API.
//
// Search uses the dedicated `/cases/search/?text=` and `/laws/search/?text=`
// endpoints (the plain list endpoints silently ignore `?search=` and return
// unfiltered results). These search endpoints are powered by an Elasticsearch
// backend that is intermittently 503 — when it's down, we surface a clear
// "search_backend_unavailable" error so the model knows to try a different
// jurisdiction. Document fetch via `/cases/{id}/` / `/laws/{id}/` is on the
// SQL backend and stays up regardless.
//
// doc_id format: "case:<id>" or "law:<id>" routes the right detail endpoint
// in getDocument.

import { DEFAULT_TIMEOUT_MS, fetchJson, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const BASE = 'https://de.openlegaldata.io/api';
const PORTAL = 'https://de.openlegaldata.io';

interface CaseListItem {
  id: number;
  slug: string;
  court?: { name?: string; slug?: string };
  file_number?: string;
  date?: string;
  type?: string;
  ecli?: string;
}

interface LawListItem {
  id: number;
  slug?: string;
  book_code?: string;
  book_slug?: string;
  title?: string;
  section?: string;
  content?: string;
}

interface ListResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export const deOpenLegalData: LegalProvider = {
  source_id: 'DE/OpenLegalData',
  jurisdiction: 'DE',
  name: 'OpenLegalData (Germany)',
  data_types: ['case_law'],
  summary:
    'German court decisions (BGH, BVerfG, OLG, LG, etc.) via OpenLegalData. Each case has a court, file_number, ECLI. Note: OpenLegalData\'s search backend is intermittently 503; when down, this provider can still fetch cases by id via legal_get_document. For statutes, use DE/GesetzeImInternet (official source) instead.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    const limit = 10;
    const params = new URLSearchParams({
      text: opts.query,
      size: String(limit),
      from: String((page - 1) * limit),
    });

    const hits: SearchHit[] = [];
    let total = 0;
    const errors: string[] = [];

    async function searchKind(kind: 'cases' | 'laws'): Promise<void> {
      const r = await fetch(`${BASE}/${kind}/search/?${params.toString()}`, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      const body = await r.text();
      let data: any;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(`OpenLegalData ${kind}/search/ ${r.status}: ${body.slice(0, 200)}`);
      }
      if (!r.ok || data?.code === 'search_backend_unavailable') {
        const msg = data?.message ?? `HTTP ${r.status}`;
        errors.push(`${kind}: ${msg}`);
        return;
      }
      total += data.count ?? 0;
      const results = data.results ?? [];
      if (kind === 'cases') {
        for (const c of results as CaseListItem[]) {
          hits.push({
            source_id: 'DE/OpenLegalData',
            doc_id: `case:${c.id}`,
            jurisdiction: 'DE',
            type: 'case_law',
            title: [c.court?.name, c.file_number, c.type].filter(Boolean).join(' — '),
            date: c.date,
            url: c.slug ? `${PORTAL}/cases/${c.slug}` : `${PORTAL}/cases/${c.id}`,
            metadata: {
              ecli: c.ecli,
              court: c.court?.name,
              court_slug: c.court?.slug,
              file_number: c.file_number,
              decision_type: c.type,
            },
          });
        }
      } else {
        for (const l of results as LawListItem[]) {
          const title = [l.book_code, l.section, l.title].filter(Boolean).join(' ');
          hits.push({
            source_id: 'DE/OpenLegalData',
            doc_id: `law:${l.id}`,
            jurisdiction: 'DE',
            type: 'legislation',
            title: title || `Law ${l.id}`,
            snippet: l.content ? stripHtml(l.content).slice(0, 300) : undefined,
            url: l.book_slug && l.slug ? `${PORTAL}/laws/${l.book_slug}/${l.slug}` : `${PORTAL}/laws/${l.id}`,
            metadata: {
              book_code: l.book_code,
              book_slug: l.book_slug,
              section: l.section,
            },
          });
        }
      }
    }

    // case_law only — DE/GesetzeImInternet handles legislation.
    if (opts.type && opts.type !== 'case_law') {
      return { source_id: 'DE/OpenLegalData', page, has_more: false, results: [] };
    }
    await searchKind('cases');

    // If every attempted backend failed (and we have nothing), surface a
    // clear error rather than empty results — the model should know.
    if (hits.length === 0 && errors.length > 0) {
      throw new Error(
        `DE/OpenLegalData search backend unavailable: ${errors.join('; ')}. ` +
          `Try again later or use a different DE source.`,
      );
    }

    return {
      source_id: 'DE/OpenLegalData',
      total,
      page,
      has_more: hits.length >= limit,
      results: hits.slice(0, limit),
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const [kind, idStr] = opts.doc_id.includes(':') ? opts.doc_id.split(':') : ['case', opts.doc_id];
    const path = kind === 'law' ? 'laws' : 'cases';
    const data = (await fetchJson(`${BASE}/${path}/${idStr}/`)) as Record<string, any>;
    const text = stripHtml(String(data.content ?? ''));
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    const isCase = kind !== 'law';
    const slug = data.slug as string | undefined;

    return {
      source_id: 'DE/OpenLegalData',
      doc_id: opts.doc_id,
      jurisdiction: 'DE',
      type: isCase ? 'case_law' : 'legislation',
      title: isCase
        ? [data.court?.name, data.file_number].filter(Boolean).join(' — ')
        : [data.book_code, data.section, data.title].filter(Boolean).join(' '),
      text: t.text,
      date: data.date,
      url: isCase
        ? slug ? `${PORTAL}/cases/${slug}` : `${PORTAL}/cases/${idStr}`
        : data.book_slug && slug ? `${PORTAL}/laws/${data.book_slug}/${slug}` : `${PORTAL}/laws/${idStr}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: isCase
        ? { ecli: data.ecli, court: data.court?.name, file_number: data.file_number }
        : { book_code: data.book_code, section: data.section },
    };
  },
};
