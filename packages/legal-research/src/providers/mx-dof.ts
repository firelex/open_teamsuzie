// MX/DOF — Mexican Diario Oficial de la Federación.
//
// No public free-text search API. Two endpoints we can use at runtime:
//   - https://sidofqa.segob.gob.mx/dof/sidof/notas/{DD-MM-YYYY} → JSON
//     listing of all notes published that day (matutina, vespertina,
//     extraordinaria editions). codNota + titulo + codSeccion etc.
//   - https://www.dof.gob.mx/nota_detalle.php?codigo={codNota}&fecha={DD/MM/YYYY}
//     → HTML detail page with the full text.
//
// Search strategy: scan a date window (default last 14 days, or a single
// day if the query mentions a date) and post-filter titles by keyword.
//
// doc_id format: "<DD-MM-YYYY>:<codNota>" so getDocument can rebuild the
// detail-page URL.

import { fetchJson, fetchText, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const SUMMARY_API = 'https://sidofqa.segob.gob.mx/dof/sidof/notas';
const DETAIL_PAGE = 'https://www.dof.gob.mx/nota_detalle.php';

interface DofNote {
  codNota?: number;
  titulo?: string;
  codSeccion?: string;
  fecha?: string; // DD-MM-YYYY
  nombreCodOrgaUno?: string;
  nombreCodOrgaDos?: string;
  pagina?: number;
}

interface DofDailySummary {
  messageCode?: number;
  NotasMatutinas?: DofNote[];
  NotasVespertinas?: DofNote[];
  NotasExtraordinarias?: DofNote[];
}

const dayCache = new Map<string, DofNote[]>();

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function fmtDate(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function detectDateInQuery(query: string): string | null {
  // DD/MM/YYYY or DD-MM-YYYY
  const m = query.match(/\b(\d{2})[-/](\d{2})[-/](\d{4})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // YYYY-MM-DD ISO
  const iso = query.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return null;
}

async function loadDay(date: string): Promise<DofNote[]> {
  const cached = dayCache.get(date);
  if (cached) return cached;
  try {
    const data = await fetchJson<DofDailySummary>(`${SUMMARY_API}/${date}`);
    const notes = [
      ...(data.NotasMatutinas ?? []),
      ...(data.NotasVespertinas ?? []),
      ...(data.NotasExtraordinarias ?? []),
    ];
    dayCache.set(date, notes);
    return notes;
  } catch {
    return [];
  }
}

export const mxDof: LegalProvider = {
  source_id: 'MX/DOF',
  jurisdiction: 'MX',
  name: 'Diario Oficial de la Federación (Mexico)',
  data_types: ['legislation'],
  summary:
    'Mexican federal Official Gazette (DOF). No free-text search; this provider scans daily summaries (matutina/vespertina/extraordinaria) and filters titles by keyword. Include a date in the query (DD/MM/YYYY or YYYY-MM-DD) to scope to one day; otherwise scans the last 14 days. doc_id format: "<DD-MM-YYYY>:<codNota>". Spanish.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'MX/DOF', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const explicitDate = detectDateInQuery(opts.query);
    const dates: string[] = explicitDate ? [explicitDate] : [];
    if (!explicitDate) {
      const today = new Date();
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(fmtDate(d));
      }
    }
    const terms = opts.query
      .toLowerCase()
      .replace(/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g, '')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const hits: SearchHit[] = [];
    for (const date of dates) {
      const notes = await loadDay(date);
      for (const n of notes) {
        if (!n.codNota || !n.titulo) continue;
        if (terms.length > 0) {
          const hay = n.titulo.toLowerCase();
          if (!terms.every((t) => hay.includes(t))) continue;
        }
        const docDate = n.fecha ?? date;
        hits.push({
          source_id: 'MX/DOF',
          doc_id: `${docDate}:${n.codNota}`,
          jurisdiction: 'MX',
          type: 'legislation',
          title: n.titulo,
          date: docDate.split('-').reverse().join('-'), // DD-MM-YYYY → YYYY-MM-DD
          url: `${DETAIL_PAGE}?codigo=${n.codNota}&fecha=${docDate.replace(/-/g, '/')}`,
          metadata: {
            cod_nota: n.codNota,
            seccion: n.codSeccion,
            organo: n.nombreCodOrgaUno,
            sub_organo: n.nombreCodOrgaDos,
            pagina: n.pagina,
          },
        });
        if (hits.length >= 20) break;
      }
      if (hits.length >= 20) break;
    }
    return {
      source_id: 'MX/DOF',
      page: 1,
      has_more: false,
      results: hits,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // doc_id = "<DD-MM-YYYY>:<codNota>"
    const m = opts.doc_id.match(/^(\d{2}-\d{2}-\d{4}):(\d+)$/);
    if (!m) {
      throw new Error(`Invalid MX doc_id "${opts.doc_id}". Expected "<DD-MM-YYYY>:<codNota>".`);
    }
    const date = m[1];
    const codigo = m[2];
    const url = `${DETAIL_PAGE}?codigo=${codigo}&fecha=${date.replace(/-/g, '/')}`;
    const html = await fetchText(url);
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    return {
      source_id: 'MX/DOF',
      doc_id: opts.doc_id,
      jurisdiction: 'MX',
      type: 'legislation',
      title: titleMatch ? stripHtml(titleMatch[1]).trim() : opts.doc_id,
      text: t.text,
      date: date.split('-').reverse().join('-'),
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { cod_nota: codigo, fecha: date },
    };
  },
};
