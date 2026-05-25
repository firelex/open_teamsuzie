// AT/RIS — Austrian Rechtsinformationssystem.
//
// Single provider that wraps two RIS API endpoints behind a unified
// surface: `/Bundesrecht` (consolidated federal legislation) and
// `/Judikatur` (case law). Free-text search via `Suchworte`. JSON.
//
// doc_id format: "leg:<NOR-id>" for legislation, "case:<JJR-id>" for case
// law, so getDocument can route to the right backend URL.

import { fetchJson, fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const API = 'https://data.bka.gv.at/ris/api/v2.6';

interface RisHit {
  Data?: {
    Metadaten?: {
      Technisch?: { ID?: string; Applikation?: string; Organ?: string };
      Allgemein?: { Veroeffentlicht?: string; Geaendert?: string; DokumentUrl?: string };
      Bundesrecht?: { Kurztitel?: string; Eli?: string; BrKons?: { Kundmachungsorgan?: string; ArtikelParagraphAnlage?: string; Abkuerzung?: string } };
      Judikatur?: { Dokumenttyp?: string; Geschaeftszahl?: { item?: string | string[] }; Entscheidungsdatum?: string };
    };
    Dokumentliste?: {
      ContentReference?: {
        Urls?: { ContentUrl?: { DataType?: string; Url?: string }[] };
      };
    };
  };
}

interface RisResponse {
  OgdSearchResult?: {
    OgdDocumentResults?: {
      Hits?: { '@pageSize'?: string; '#text'?: string };
      OgdDocumentReference?: RisHit | RisHit[];
    };
    Error?: { Message?: string };
  };
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function htmlUrl(hit: RisHit): string | undefined {
  const urls = hit.Data?.Dokumentliste?.ContentReference?.Urls?.ContentUrl ?? [];
  return urls.find((u) => u.DataType === 'Html')?.Url ?? hit.Data?.Metadaten?.Allgemein?.DokumentUrl;
}

async function searchEndpoint(
  endpoint: 'Bundesrecht' | 'Judikatur',
  application: 'BrKons' | 'Justiz',
  query: string,
  page: number,
): Promise<{ hits: RisHit[]; total: number }> {
  const params = new URLSearchParams({
    Applikation: application,
    Suchworte: query,
    Seitennummer: String(page),
    DokumenteProSeite: 'Ten',
  });
  const data = await fetchJson<RisResponse>(`${API}/${endpoint}?${params.toString()}`);
  if (data.OgdSearchResult?.Error?.Message) {
    throw new Error(`RIS error: ${data.OgdSearchResult.Error.Message}`);
  }
  const block = data.OgdSearchResult?.OgdDocumentResults;
  const hits = asArray(block?.OgdDocumentReference);
  const total = parseInt(block?.Hits?.['#text'] ?? '0', 10);
  return { hits, total };
}

export const atRis: LegalProvider = {
  source_id: 'AT/RIS',
  jurisdiction: 'AT',
  name: 'RIS (Austria)',
  data_types: ['legislation', 'case_law'],
  summary:
    'Austria\'s Rechtsinformationssystem — federal Bundesrecht (consolidated laws) and Judikatur (court decisions, OGH/VfGH/VwGH/etc). Search via German keywords. Each result has an ELI/ECLI when available.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    const page = opts.page ?? 1;
    const out: SearchHit[] = [];
    let total = 0;

    if (!opts.type || opts.type === 'legislation') {
      try {
        const { hits, total: t } = await searchEndpoint('Bundesrecht', 'BrKons', opts.query, page);
        total += t;
        for (const h of hits) {
          const id = h.Data?.Metadaten?.Technisch?.ID;
          if (!id) continue;
          out.push({
            source_id: 'AT/RIS',
            doc_id: `leg:${id}`,
            jurisdiction: 'AT',
            type: 'legislation',
            title: [
              h.Data?.Metadaten?.Bundesrecht?.Kurztitel,
              h.Data?.Metadaten?.Bundesrecht?.BrKons?.ArtikelParagraphAnlage,
            ]
              .filter(Boolean)
              .join(' — ') || id,
            date: h.Data?.Metadaten?.Allgemein?.Veroeffentlicht,
            url: h.Data?.Metadaten?.Allgemein?.DokumentUrl ?? `https://www.ris.bka.gv.at/Dokumente/Bundesnormen/${id}/${id}.html`,
            metadata: {
              eli: h.Data?.Metadaten?.Bundesrecht?.Eli,
              kundmachung: h.Data?.Metadaten?.Bundesrecht?.BrKons?.Kundmachungsorgan,
              abk: h.Data?.Metadaten?.Bundesrecht?.BrKons?.Abkuerzung,
              organ: h.Data?.Metadaten?.Technisch?.Organ,
            },
          });
        }
      } catch {
        /* swallow legislation failure if we still have case_law to try */
      }
    }

    if (!opts.type || opts.type === 'case_law') {
      try {
        const { hits, total: t } = await searchEndpoint('Judikatur', 'Justiz', opts.query, page);
        total += t;
        for (const h of hits) {
          const id = h.Data?.Metadaten?.Technisch?.ID;
          if (!id) continue;
          const gz = h.Data?.Metadaten?.Judikatur?.Geschaeftszahl?.item;
          const gzStr = Array.isArray(gz) ? gz[0] : gz;
          out.push({
            source_id: 'AT/RIS',
            doc_id: `case:${id}`,
            jurisdiction: 'AT',
            type: 'case_law',
            title: [h.Data?.Metadaten?.Technisch?.Organ, gzStr, h.Data?.Metadaten?.Judikatur?.Dokumenttyp]
              .filter(Boolean)
              .join(' — ') || id,
            date: h.Data?.Metadaten?.Judikatur?.Entscheidungsdatum ?? h.Data?.Metadaten?.Allgemein?.Veroeffentlicht,
            url: htmlUrl(h) ?? `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Justiz&Dokumentnummer=${id}`,
            metadata: {
              court: h.Data?.Metadaten?.Technisch?.Organ,
              decision_type: h.Data?.Metadaten?.Judikatur?.Dokumenttyp,
              geschaeftszahl: gzStr,
            },
          });
        }
      } catch {
        /* same — partial results are still useful */
      }
    }

    return {
      source_id: 'AT/RIS',
      total,
      page,
      has_more: out.length >= 10,
      results: out,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const [kind, id] = opts.doc_id.includes(':') ? opts.doc_id.split(':') : ['leg', opts.doc_id];
    const isLeg = kind === 'leg';
    const url = isLeg
      ? `https://www.ris.bka.gv.at/Dokumente/Bundesnormen/${id}/${id}.html`
      : `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Justiz&Dokumentnummer=${id}`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'AT/RIS',
      doc_id: opts.doc_id,
      jurisdiction: 'AT',
      type: isLeg ? 'legislation' : 'case_law',
      title: id,
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
    };
  },
};
