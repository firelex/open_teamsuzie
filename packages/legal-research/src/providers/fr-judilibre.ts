// FR/Judilibre — French case law (Cour de cassation, courts of appeal,
// tribunaux judiciaires, tribunaux de commerce) via the PISTE Judilibre
// API. API-key auth via the `KeyId` header.
//
// Docs: https://api.gouv.fr/les-api/api-judilibre

import { stripHtml, truncateText, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const API_BASE = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0';

interface BuildOptions {
  apiKey: string;
}

export function buildFrJudilibre(opts: BuildOptions): LegalProvider {
  const headers = (): Record<string, string> => ({
    KeyId: opts.apiKey,
    Accept: 'application/json',
  });

  async function getJson(url: string): Promise<any> {
    const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Judilibre ${r.status}: ${text.slice(0, 300)}`);
    }
    return r.json();
  }

  return {
    source_id: 'FR/Judilibre',
    jurisdiction: 'FR',
    name: 'Judilibre (France — Cour de cassation et juridictions)',
    data_types: ['case_law'],
    summary:
      'French judicial decisions: Cour de cassation, courts of appeal, tribunaux. Each decision has an internal id and ECLI. Tip: query supports keywords; metadata returns chamber, jurisdiction (cc/ca/tj/tcom), solution, themes.',

    async search(opts: SearchOpts): Promise<SearchResults> {
      if (opts.type && opts.type !== 'case_law') {
        return { source_id: 'FR/Judilibre', page: opts.page ?? 1, has_more: false, results: [] };
      }
      const page = opts.page ?? 1;
      const params = new URLSearchParams({
        query: opts.query,
        page: String(page - 1),
        page_size: '10',
        resolve_references: 'true',
      });
      if (opts.date_from) params.set('date_start', opts.date_from);
      if (opts.date_to) params.set('date_end', opts.date_to);
      const data = await getJson(`${API_BASE}/search?${params.toString()}`);
      const total = typeof data.total === 'number' ? data.total : undefined;
      const results: SearchHit[] = (data.results ?? []).map((r: any) => ({
        source_id: 'FR/Judilibre',
        doc_id: r.id,
        jurisdiction: 'FR',
        type: 'case_law',
        title: [r.jurisdiction, r.chamber, r.number].filter(Boolean).join(' — ') || r.id,
        snippet: typeof r.text === 'string' ? r.text.slice(0, 500) : undefined,
        date: r.decision_date,
        url: r.id ? `${API_BASE}/decision?id=${r.id}` : '',
        metadata: {
          ecli: r.ecli,
          chamber: r.chamber,
          jurisdiction_code: r.jurisdiction,
          solution: r.solution,
          themes: r.themes,
          number: r.number,
        },
      }));
      return { source_id: 'FR/Judilibre', total, page, has_more: page * 10 < (total ?? 0), results };
    },

    async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
      const params = new URLSearchParams({ id: opts.doc_id, resolve_references: 'true' });
      const data = await getJson(`${API_BASE}/decision?${params.toString()}`);
      const text = stripHtml(String(data.text ?? data.text_html ?? ''));
      const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
      const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };

      return {
        source_id: 'FR/Judilibre',
        doc_id: opts.doc_id,
        jurisdiction: 'FR',
        type: 'case_law',
        title: [data.jurisdiction, data.chamber, data.number].filter(Boolean).join(' — ') || opts.doc_id,
        text: t.text,
        date: data.decision_date,
        url: `${API_BASE}/decision?id=${opts.doc_id}`,
        full_length_chars: t.full_length_chars,
        truncated: t.truncated,
        metadata: {
          ecli: data.ecli,
          chamber: data.chamber,
          solution: data.solution,
          themes: data.themes,
          formation: data.formation,
        },
      };
    },
  };
}
