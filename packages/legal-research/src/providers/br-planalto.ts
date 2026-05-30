// BR/Planalto — Brazilian federal legislation.
//
// Search: LexML web search (lexml.gov.br/busca/search?keyword=) returns
// HTML with URN-based result links. We parse the URNs (which are the
// canonical Brazilian legal identifiers, e.g. urn:lex:br:federal:lei:
// 1996-09-23;9307 = Lei 9.307/1996, the arbitration law).
//
// Fetch: most federal lei/decreto/lei.complementar texts live at
// planalto.gov.br under predictable paths (ISO-8859-1 HTML). We try the
// known URL templates per URN type. If none resolve, we fall back to the
// LexML metadata page so the model at least gets a citable link.

import {
  fetchText,
  stripHtml,
  truncateText,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_TEXT_CHARS,
} from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const LEXML_SEARCH = 'https://www.lexml.gov.br/busca/search';
const LEXML_BASE = 'https://www.lexml.gov.br';
const PLANALTO_BASE = 'https://www.planalto.gov.br';

interface ParsedUrn {
  authority: string; // "federal", "estadual.SP", etc.
  type: string; // "lei", "decreto", "lei.complementar", "constituicao", "medida.provisoria", ...
  date?: string; // YYYY-MM-DD
  number?: string;
}

function parseUrn(urn: string): ParsedUrn | null {
  // urn:lex:<jurisdiction>:<authority>:<type>:<date>;<number>
  const m = urn.match(/^urn:lex:([^:]+):([^:]+):([^:]+):([^;]+);(.+)$/);
  if (!m) return null;
  return {
    authority: m[2],
    type: m[3],
    date: m[4],
    number: m[5],
  };
}

function planaltoUrlsForUrn(urn: string): string[] {
  const parsed = parseUrn(urn);
  if (!parsed || parsed.authority !== 'federal') return [];
  const num = (parsed.number ?? '').replace(/\./g, '');
  const year = parsed.date?.slice(0, 4) ?? '';

  switch (parsed.type) {
    case 'lei':
      // Older laws live at /ccivil_03/leis/L<num>.htm; modern (post-1998) at
      // /ccivil_03/_Ato<range>/<year>/Lei/L<num>.htm. Try both.
      return [
        `${PLANALTO_BASE}/ccivil_03/leis/L${num}.htm`,
        `${PLANALTO_BASE}/ccivil_03/leis/L${num}compilado.htm`,
        // Modern range placeholder: planalto bins by year ranges (2007-2010 etc.)
        // Without the exact range we can't construct it; the older /leis/ path
        // covers most laws including current-day reissues.
      ];
    case 'lei.complementar':
      return [
        `${PLANALTO_BASE}/ccivil_03/leis/lcp/Lcp${num}.htm`,
        `${PLANALTO_BASE}/ccivil_03/leis/Lcp/Lcp${num}.htm`,
      ];
    case 'decreto':
      return [
        `${PLANALTO_BASE}/ccivil_03/decreto/D${num}.htm`,
        `${PLANALTO_BASE}/ccivil_03/decreto/${year}/D${num}.htm`,
        `${PLANALTO_BASE}/ccivil_03/_Ato${year}/${year}/Decreto/D${num}.htm`,
      ];
    case 'decreto-lei':
      return [`${PLANALTO_BASE}/ccivil_03/decreto-lei/Del${num}.htm`];
    case 'medida.provisoria':
      return [
        `${PLANALTO_BASE}/ccivil_03/_Ato${year}/${year}/Mpv/Mpv${num}.htm`,
        `${PLANALTO_BASE}/ccivil_03/MPV/${num}.htm`,
      ];
    case 'constituicao':
      return [`${PLANALTO_BASE}/ccivil_03/constituicao/constituicao.htm`];
    default:
      return [];
  }
}

function citationFromUrn(urn: string): string {
  const p = parseUrn(urn);
  if (!p) return urn;
  const typeLabels: Record<string, string> = {
    lei: 'Lei',
    'lei.complementar': 'Lei Complementar',
    decreto: 'Decreto',
    'decreto-lei': 'Decreto-Lei',
    'medida.provisoria': 'Medida Provisória',
    constituicao: 'Constituição',
  };
  const label = typeLabels[p.type] ?? p.type;
  if (p.type === 'constituicao') return `Constituição Federal de ${p.date?.slice(0, 4) ?? ''}`;
  return `${label} ${p.number}/${p.date?.slice(0, 4) ?? ''}`;
}

function parseLexmlSearch(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  // Each result block looks like:
  //   <a href="/urn/urn:lex:br:federal:lei:1996-09-23;9307">Lei nº 9.307...</a>
  //   <span ...>... ementa ...</span>
  const linkRegex = /href="\/urn\/(urn:lex:[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const urn = decodeURIComponent(m[1]);
    if (seen.has(urn)) continue;
    seen.add(urn);
    const parsed = parseUrn(urn);
    if (!parsed || parsed.authority !== 'federal') continue;
    if (!['lei', 'lei.complementar', 'decreto', 'decreto-lei', 'medida.provisoria', 'constituicao'].includes(parsed.type)) continue;
    const linkText = stripHtml(m[2]).trim().slice(0, 250);
    // Look ahead a small window for an ementa/description
    const after = html.slice(m.index, m.index + 2500);
    const emMatch = after.match(/<(?:p|span|div)[^>]*>([^<]{40,400})<\/(?:p|span|div)>/);
    const snippet = emMatch ? stripHtml(emMatch[1]).trim().slice(0, 400) : undefined;
    out.push({
      source_id: 'BR/Planalto',
      doc_id: urn,
      jurisdiction: 'BR',
      type: 'legislation',
      title: linkText || citationFromUrn(urn),
      snippet,
      date: parsed.date,
      url: `${LEXML_BASE}/urn/${encodeURIComponent(urn)}`,
      metadata: { urn, citation: citationFromUrn(urn), type: parsed.type, number: parsed.number },
    });
    if (out.length >= 20) break;
  }
  return out;
}

async function fetchPlanalto(url: string): Promise<string> {
  return fetchText(url, {
    decoder: 'iso-8859-1',
    headers: { 'User-Agent': 'suzielaw-legal-research/1.0', Accept: 'text/html' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}

export const brPlanalto: LegalProvider = {
  source_id: 'BR/Planalto',
  jurisdiction: 'BR',
  name: 'Planalto + LexML (Brazil — federal legislation)',
  data_types: ['legislation'],
  summary:
    'Brazilian federal legislation: leis, leis complementares, decretos, decretos-lei, medidas provisórias, Constituição. Search via LexML (URN-indexed); document text fetched from planalto.gov.br when a known URL pattern resolves. doc_id is the canonical URN (e.g. urn:lex:br:federal:lei:1996-09-23;9307 = Lei 9.307/1996). Portuguese.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'BR/Planalto', page: opts.page ?? 1, has_more: false, results: [] };
    }
    // LexML's search form uses `keyword=` for the free-text query, plus
    // `f1-tipoDocumento=Legislação` to filter to legislation. Build the query
    // string manually since the second field has a hyphen.
    const q = `keyword=${encodeURIComponent(opts.query)}&f1-tipoDocumento=Legisla%C3%A7%C3%A3o`;
    const html = await fetchText(`${LEXML_SEARCH}?${q}`, {
      headers: { 'User-Agent': 'suzielaw-legal-research/1.0' },
    });
    const hits = parseLexmlSearch(html);
    return {
      source_id: 'BR/Planalto',
      page: opts.page ?? 1,
      has_more: hits.length >= 20,
      results: hits,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    const candidates = planaltoUrlsForUrn(opts.doc_id);
    let html: string | null = null;
    let url = `${LEXML_BASE}/urn/${encodeURIComponent(opts.doc_id)}`;
    let lastErr: Error | null = null;
    for (const candidate of candidates) {
      try {
        html = await fetchPlanalto(candidate);
        if (html.length > 200) {
          url = candidate;
          break;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (!html) {
      throw new Error(
        `Could not fetch ${opts.doc_id} from any known Planalto URL pattern${
          lastErr ? `: ${lastErr.message}` : ''
        }. Cite the LexML reference at ${url}.`,
      );
    }
    const text = stripHtml(html);
    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
    return {
      source_id: 'BR/Planalto',
      doc_id: opts.doc_id,
      jurisdiction: 'BR',
      type: 'legislation',
      title: citationFromUrn(opts.doc_id),
      text: t.text,
      url,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      metadata: { urn: opts.doc_id, planalto_url: url },
    };
  },
};
