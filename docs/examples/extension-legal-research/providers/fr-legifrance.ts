// FR/Legifrance — French legislation (codes, ordonnances, lois) via the
// PISTE Légifrance REST API. OAuth2 client_credentials.
//
// Search hits the `/search` endpoint with a free-text query against the
// CODE_DATE_VERSION fond (consolidated codes); document fetch hits
// `/consult/getArticle` with the article's LEGIARTI id.
//
// PISTE registration: https://piste.gouv.fr/ (free).

import { stripHtml, truncateText, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token';
const API_BASE = 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app';
const PUBLIC_BASE = 'https://www.legifrance.gouv.fr';

interface BuildOptions {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  access_token: string;
  expires_at: number;
}

export function buildFrLegifrance(opts: BuildOptions): LegalProvider {
  let cached: CachedToken | null = null;

  async function getToken(): Promise<string> {
    const now = Date.now();
    if (cached && cached.expires_at > now + 60_000) return cached.access_token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      scope: 'openid',
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`Légifrance OAuth failed: ${r.status}`);
    const json = (await r.json()) as { access_token: string; expires_in: number };
    cached = { access_token: json.access_token, expires_at: now + json.expires_in * 1000 };
    return cached.access_token;
  }

  async function piste(path: string, body: unknown): Promise<any> {
    const token = await getToken();
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Légifrance ${path} ${r.status}: ${text.slice(0, 300)}`);
    }
    return r.json();
  }

  return {
    source_id: 'FR/Legifrance',
    jurisdiction: 'FR',
    name: 'Légifrance (France)',
    data_types: ['legislation'],
    summary:
      'French consolidated codes (Code civil, Code pénal, Code du travail, Code de commerce, etc.) and JORF legislation via the PISTE Légifrance API. Articles identified by LEGIARTI ids; codes by LEGITEXT ids.',

    async search(opts: SearchOpts): Promise<SearchResults> {
      if (opts.type && opts.type !== 'legislation') {
        return { source_id: 'FR/Legifrance', page: opts.page ?? 1, has_more: false, results: [] };
      }
      const page = opts.page ?? 1;
      const today = new Date().toISOString().slice(0, 10);

      // Légifrance "search" with the consolidated-code corpus. Returns
      // article-level hits with LEGIARTI ids and excerpts.
      const data = await piste('/search', {
        recherche: {
          champs: [
            {
              typeChamp: 'ALL',
              criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: opts.query, operateur: 'ET' }],
              operateur: 'ET',
            },
          ],
          filtres: [
            { facette: 'DATE_VERSION', singleDate: today },
            { facette: 'TEXT_LEGAL_STATUS', valeur: 'VIGUEUR' },
          ],
          pageNumber: page,
          pageSize: 10,
          operateur: 'ET',
          sort: 'PERTINENCE',
          typePagination: 'DEFAUT',
        },
        fond: 'CODE_DATE_VERSION',
      });

      const hits: SearchHit[] = [];
      for (const result of data?.results ?? []) {
        for (const section of result?.sections ?? [{ id: result.titles?.[0]?.id, title: result.titles?.[0]?.titre }]) {
          for (const ext of section?.extracts ?? [{ id: section.id ?? result.id, num: '', values: [] }]) {
            const id = ext.id ?? section.id ?? result.id;
            if (!id) continue;
            const title = [result.titles?.[0]?.titre, section.title, ext.num].filter(Boolean).join(' — ');
            const snippet = (ext.values ?? []).map((v: any) => stripHtml(String(v))).join(' ').slice(0, 500);
            hits.push({
              source_id: 'FR/Legifrance',
              doc_id: id,
              jurisdiction: 'FR',
              type: 'legislation',
              title: title || id,
              snippet,
              url: `${PUBLIC_BASE}/codes/article_lc/${id}`,
              metadata: {
                legiarti: id,
                code: result.titles?.[0]?.titre,
                code_id: result.titles?.[0]?.id,
              },
            });
          }
        }
      }

      return {
        source_id: 'FR/Legifrance',
        total: typeof data?.totalResultNumber === 'number' ? data.totalResultNumber : undefined,
        page,
        has_more: hits.length === 10,
        results: hits.slice(0, 10),
      };
    },

    async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
      const data = await piste('/consult/getArticle', { id: opts.doc_id });
      const article = data?.article ?? {};
      const text = stripHtml(article.texte ?? article.texteHtml ?? '');
      const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
      const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };

      return {
        source_id: 'FR/Legifrance',
        doc_id: opts.doc_id,
        jurisdiction: 'FR',
        type: 'legislation',
        title: article.num ? `Article ${article.num}` : opts.doc_id,
        text: t.text,
        date: article.dateDebut ?? article.dateModif,
        url: `${PUBLIC_BASE}/codes/article_lc/${opts.doc_id}`,
        full_length_chars: t.full_length_chars,
        truncated: t.truncated,
        metadata: {
          num: article.num,
          etat: article.etat,
          cid: article.cid,
          context: article.context,
        },
      };
    },
  };
}
