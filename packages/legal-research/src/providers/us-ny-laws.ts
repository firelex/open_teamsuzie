// US-NY/Laws — the Laws of New York (the Consolidated Laws, plus unconsolidated laws and court acts)
// via the New York State Senate's Open Legislation API.
//
// Fetch:  GET /api/3/laws/{lawId}/{locationId}?key=  → JSON, the current text of one section/article
// Search: GET /api/3/laws/search?term=&limit=&offset=&key=  → JSON, full-text (Elasticsearch query string)
//
// A law is a three-letter id (LAB = Labor Law, GBS = General Business Law, GOB = General Obligations
// Law); a section's location id is its number, upper-cased (LAB/195, GBS/899-BB, GOB/5-1401). A query
// that reads as a citation ("Labor Law 195", "GBL 899-bb", "N.Y. Gen. Oblig. Law § 5-1401") is looked
// up directly; anything else goes to the full-text search.
//
// Auth: a free API key, sent as the `key` query parameter (so error messages here never quote the URL).
// Rate limits from 1 December 2026: 10 requests/second and 4 in flight per key; 429 with Retry-After.
// Content is published under Creative Commons BY-NC-ND 3.0 US (see the Open Legislation home page).
//
// Docs: https://legislation.nysenate.gov/static/docs/html/laws.html

import { DEFAULT_TIMEOUT_MS, stripHtml, truncateText, DEFAULT_MAX_TEXT_CHARS } from '../util.js';
import type {
  LegalProvider,
  SearchOpts,
  SearchResults,
  SearchHit,
  GetDocumentOpts,
  FullDocument,
} from '../types.js';

const API = 'https://legislation.nysenate.gov/api/3';
const VIEWER = 'https://www.nysenate.gov/legislation/laws';
const SOURCE_ID = 'US-NY/Laws';
const JURISDICTION = 'US-NY';
const PER_PAGE = 10;

interface BuildOptions {
  apiKey: string;
}

/** The Consolidated Laws, by the API's three-letter id, with the API's names. */
const CONSOLIDATED_LAWS: Record<string, string> = {
  ABC: 'Alcoholic Beverage Control', ABP: 'Abandoned Property', ACA: 'Arts and Cultural Affairs',
  ACG: 'Alternative County Government', AGM: 'Agriculture & Markets', BNK: 'Banking',
  BSC: 'Business Corporation', BVO: 'Benevolent Orders', CAL: 'Canal', CAN: 'Cannabis',
  CCO: 'Cooperative Corporations', CNT: 'County', COM: 'Economic Development Law', COR: 'Correction',
  CPL: 'Criminal Procedure', CVP: 'Civil Practice Law & Rules', CVR: 'Civil Rights', CVS: 'Civil Service',
  DCD: 'Debtor & Creditor', DOM: 'Domestic Relations', EDN: 'Education', EDP: 'Eminent Domain Procedure',
  ELD: 'Elder', ELN: 'Election', EML: "Employers' Liability", ENG: 'Energy',
  ENV: 'Environmental Conservation', EPT: 'Estates, Powers & Trusts', EXC: 'Executive',
  FIS: 'Financial Services Law', GAS: 'General Associations', GBS: 'General Business',
  GCN: 'General Construction', GCT: 'General City', GMU: 'General Municipal', GOB: 'General Obligations',
  HAY: 'Highway', IND: 'Indian', ISC: 'Insurance', JUD: 'Judiciary', LAB: 'Labor', LEG: 'Legislative',
  LFN: 'Local Finance', LIE: 'Lien', LLC: 'Limited Liability Company Law', MDW: 'Multiple Dwelling',
  MHA: 'Municipal Housing Authorities', MHR: 'Municipal Home Rule', MHY: 'Mental Hygiene',
  MIL: 'Military', MRE: 'Multiple Residence', NAV: 'Navigation', NPC: 'Not-for-Profit Corporation',
  PAR: 'Parks, Recreation and Historic Preservation', PBA: 'Public Authorities', PBB: 'Public Buildings',
  PBG: 'Public Housing', PBH: 'Public Health', PBL: 'Public Lands', PBO: 'Public Officers',
  PBS: 'Public Service', PEN: 'Penal', PEP: 'Personal Property',
  PML: 'Racing, Pari-Mutuel Wagering and Breeding Law', PPD: 'New York State Printing and Public Documents',
  PTR: 'Partnership', PVH: 'Private Housing Finance', RAT: 'Rapid Transit', RCO: 'Religious Corporations',
  REL: 'Rural Electric Cooperative', RPA: 'Real Property Actions & Proceedings', RPP: 'Real Property',
  RPT: 'Real Property Tax', RRD: 'Railroad', RSS: 'Retirement & Social Security',
  SAP: 'State Administrative Procedure Act', SCC: 'Second Class Cities', SLG: 'Statute of Local Governments',
  SOS: 'Social Services', STF: 'State Finance', STL: 'State', STT: 'State Technology',
  SWC: 'Soil & Water Conservation Districts', TAX: 'Tax', TCP: 'Transportation Corporations',
  TRA: 'Transportation', TWN: 'Town', UCC: 'Uniform Commercial Code', VAT: 'Vehicle & Traffic',
  VAW: "Volunteer Ambulance Workers' Benefit", VET: "Veterans' Services", VIL: 'Village',
  VOL: "Volunteer Firefighters' Benefit", WKC: "Workers' Compensation",
};

/**
 * How practitioners cite the laws, beyond the API's ids and names: the usual initialisms (GBL, GOL,
 * CPLR) and the Bluebook's abbreviations ("Gen. Oblig.", "Lab."), keyed in normalized form (see `norm`).
 */
const ALIASES: Record<string, string> = {
  gbl: 'GBS', gol: 'GOB', cplr: 'CVP', eptl: 'EPT', bcl: 'BSC', vtl: 'VAT', rpl: 'RPP', rpapl: 'RPA',
  rptl: 'RPT', drl: 'DOM', llcl: 'LLC', npcl: 'NPC', pl: 'PEN', ucc: 'UCC', gml: 'GMU', gcl: 'GCN',
  sapa: 'SAP', nyll: 'LAB', wcl: 'WKC', ssl: 'SOS', phl: 'PBH', ecl: 'ENV', mdl: 'MDW', pal: 'PBA',
  pol: 'PBO', crl: 'CVR', dcl: 'DCD', abcl: 'ABC', rssl: 'RSS', psl: 'PBS', stfl: 'STF',
  lab: 'LAB', 'gen bus': 'GBS', 'gen oblig': 'GOB', 'civ rights': 'CVR', exec: 'EXC', 'bus corp': 'BSC',
  'ltd liab co': 'LLC', 'not for profit corp': 'NPC', 'est powers and trusts': 'EPT', 'dom rel': 'DOM',
  'real prop': 'RPP', 'real prop acts': 'RPA', 'real prop tax': 'RPT', 'veh and traf': 'VAT', ins: 'ISC',
  'pub health': 'PBH', jud: 'JUD', educ: 'EDN', 'envtl conserv': 'ENV', 'gen mun': 'GMU', 'crim proc': 'CPL',
  'workers comp': 'WKC', 'debt and cred': 'DCD', 'soc serv': 'SOS', 'civ serv': 'CVS', 'pub off': 'PBO',
  elec: 'ELN', 'fin serv': 'FIS', 'gen constr': 'GCN', 'state fin': 'STF', 'pub auth': 'PBA',
  'mult dwell': 'MDW', 'alco bev cont': 'ABC', 'retire and soc sec': 'RSS', 'mental hyg': 'MHY',
  'agric and mkts': 'AGM', 'arts and cult aff': 'ACA', 'pub serv': 'PBS', 'gen assns': 'GAS',
  'gen city': 'GCT', 'priv hous fin': 'PVH', 'pers prop': 'PEP', 'u c c': 'UCC', 'c p l r': 'CVP',
  'civil practice law and rules': 'CVP', 'civil practice': 'CVP',
};

/** Lower-case, `&` → `and`, punctuation dropped, "N.Y."/"McKinney's" prefix and a trailing "Law" removed. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^mckinneys\s+/, '')
    .replace(/^(?:new york|ny)\s+/, '')
    .replace(/^(?:consolidated\s+)?laws?\s+of\s+(?:new york|ny)\s+/, '')
    .replace(/\s+(?:law|laws)$/, '')
    .trim();
}

const LAW_BY_KEY: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [id, name] of Object.entries(CONSOLIDATED_LAWS)) {
    map.set(id.toLowerCase(), id);
    map.set(norm(name), id);
  }
  for (const [alias, id] of Object.entries(ALIASES)) map.set(alias, id);
  return map;
})();

/** "Labor" → "Labor Law"; names that already say what they are ("… Law", "… Act", "… Code") stay. */
function lawTitle(name: string): string {
  return /\b(Law|Laws|Act|Code|Rules|Statute)\b/i.test(name) ? name : `${name} Law`;
}

/**
 * A query read as a citation to one section: `<law> [§|section] <number>` or `§ <number> of the <law>`.
 * Subdivisions in parentheses ("195(1)(a)") are dropped: the section is the document.
 */
export function parseNyCitation(query: string): { lawId: string; section: string } | null {
  const q = query.trim().replace(/\s+/g, ' ');
  const SECTION = String.raw`(\d[0-9A-Za-z.\-]*?)(?:\([^)]*\))*\.?`;
  const SIGN = String.raw`(?:§+|sec(?:tion)?s?\.?|s\.)`;
  const lawFirst = new RegExp(String.raw`^(.+?)[\s,]*(?:${SIGN})?\s*${SECTION}$`, 'i').exec(q);
  const sectionFirst = new RegExp(String.raw`^${SIGN}\s*${SECTION}\s+(?:of\s+)?(?:the\s+)?(.+)$`, 'i').exec(q);
  const candidates: Array<[string, string]> = [];
  if (lawFirst) candidates.push([lawFirst[1], lawFirst[2]]);
  if (sectionFirst) candidates.push([sectionFirst[2], sectionFirst[1]]);
  for (const [lawPart, section] of candidates) {
    const lawId = LAW_BY_KEY.get(norm(lawPart));
    if (lawId) return { lawId, section: section.replace(/\.$/, '').toUpperCase() };
  }
  return null;
}

function parseDocId(docId: string): { lawId: string; locationId: string } {
  const m = /^([A-Za-z0-9]{3})\/(.+)$/.exec(docId.trim());
  if (!m) {
    throw new Error(`Invalid ${SOURCE_ID} doc_id "${docId}". Expected "<law id>/<location id>", e.g. "LAB/195" or "GBS/899-BB".`);
  }
  return { lawId: m[1].toUpperCase(), locationId: m[2].toUpperCase() };
}

/** A sub-document's heading for people: "Labor Law § 195 — Notice and record-keeping requirements". */
function docHeading(d: { lawName?: string; lawId: string; docType?: string; docLevelId?: string; title?: string }): string {
  const law = lawTitle(d.lawName ?? CONSOLIDATED_LAWS[d.lawId] ?? d.lawId);
  const where =
    d.docType === 'SECTION' ? `${law} § ${d.docLevelId}`
    : d.docType === 'CHAPTER' ? law
    : `${law}, ${(d.docType ?? '').charAt(0)}${(d.docType ?? '').slice(1).toLowerCase()} ${d.docLevelId ?? ''}`.trim();
  return d.title ? `${where} — ${d.title}` : where;
}

/** The API escapes newlines in some text fields as a literal backslash-n. */
function unescapeNewlines(s: string): string {
  return s.replace(/\\n/g, '\n');
}

interface LawDocInfo {
  lawId: string;
  lawName?: string;
  locationId: string;
  title?: string;
  docType?: string;
  docLevelId?: string;
  activeDate?: string;
}

interface LawDocDetail extends LawDocInfo {
  text?: string;
  parentLocationIds?: string[];
  parents?: LawDocInfo[];
}

interface Envelope<T> {
  success: boolean;
  message?: string;
  responseType?: string;
  errorCode?: number;
  total?: number;
  offsetStart?: number;
  offsetEnd?: number;
  result?: T;
}

interface SearchItem {
  result: LawDocInfo;
  rank?: number;
  highlights?: { text?: string[]; title?: string[] };
}

export function buildUsNyLaws(opts: BuildOptions): LegalProvider {
  if (!opts.apiKey) throw new Error(`${SOURCE_ID} needs an Open Legislation API key.`);

  /** GET an API path; `null` on 404 when `allowNotFound`, otherwise every failure throws. */
  async function getJson<T>(path: string, params: Record<string, string>, allowNotFound = false): Promise<Envelope<T> | null> {
    const qs = new URLSearchParams({ ...params, key: opts.apiKey });
    const r = await fetch(`${API}${path}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (r.status === 404 && allowNotFound) return null;
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const retry = r.headers.get('Retry-After');
      // The URL carries the key, so name only the path.
      throw new Error(
        `Open Legislation ${r.status} for ${path}${retry ? ` (retry after ${retry}s)` : ''}: ${body.slice(0, 300)}`,
      );
    }
    const json = (await r.json()) as Envelope<T>;
    if (!json.success) {
      throw new Error(`Open Legislation error for ${path} (code ${json.errorCode}): ${json.message ?? 'no message'}`);
    }
    return json;
  }

  function hitFrom(d: LawDocInfo, snippet: string | undefined, extra: Record<string, unknown>): SearchHit {
    return {
      source_id: SOURCE_ID,
      doc_id: `${d.lawId}/${d.locationId}`,
      jurisdiction: JURISDICTION,
      type: 'legislation',
      title: docHeading(d),
      snippet,
      date: d.activeDate,
      url: `${VIEWER}/${d.lawId}/${d.locationId}`,
      metadata: { law_id: d.lawId, law_name: d.lawName, doc_type: d.docType, doc_level_id: d.docLevelId, ...extra },
    };
  }

  return {
    source_id: SOURCE_ID,
    jurisdiction: JURISDICTION,
    name: 'Laws of New York (NY Senate Open Legislation)',
    data_types: ['legislation'],
    summary:
      'New York State statutes — the Consolidated Laws (Labor, General Business, General Obligations, Civil Rights, Executive, CPLR, EPTL, UCC and the rest), current text, via the NY Senate Open Legislation API. A citation query ("Labor Law 195", "GBL 899-bb", "N.Y. Gen. Oblig. Law § 5-1401") returns that section; other queries run a full-text search. doc_id is "<law id>/<section>", e.g. "LAB/195".',

    async search(o: SearchOpts): Promise<SearchResults> {
      const page = o.page ?? 1;
      if (o.type && o.type !== 'legislation') {
        return { source_id: SOURCE_ID, page, has_more: false, results: [] };
      }

      const cite = parseNyCitation(o.query);
      if (cite) {
        // A citation names one section: it exists or it does not; there is no second page.
        if (page > 1) return { source_id: SOURCE_ID, total: undefined, page, has_more: false, results: [] };
        const data = await getJson<LawDocDetail>(`/laws/${cite.lawId}/${encodeURIComponent(cite.section)}`, {}, true);
        if (!data) return { source_id: SOURCE_ID, total: 0, page, has_more: false, results: [] };
        const d = data.result!;
        const snippet = d.text ? unescapeNewlines(d.text).replace(/\s+/g, ' ').trim().slice(0, 500) : undefined;
        return { source_id: SOURCE_ID, total: 1, page, has_more: false, results: [hitFrom(d, snippet, { matched: 'citation' })] };
      }

      // Full-text search; dates filter on the date the document's current text took effect.
      let term = o.query;
      if (o.date_from || o.date_to) term = `(${term}) AND activeDate:[${o.date_from ?? '*'} TO ${o.date_to ?? '*'}]`;
      const data = await getJson<{ items: SearchItem[] }>('/laws/search', {
        term,
        limit: String(PER_PAGE),
        offset: String((page - 1) * PER_PAGE + 1),
        sort: '_score:DESC',
      });
      const items = data!.result?.items ?? [];
      const results = items.map((it) => {
        const hl = it.highlights?.text?.map((h) => stripHtml(unescapeNewlines(h)).replace(/\s+/g, ' ')).join(' … ');
        return hitFrom(it.result, hl ? hl.slice(0, 500) : undefined, { matched: 'full_text', rank: it.rank });
      });
      const total = data!.total;
      return {
        source_id: SOURCE_ID,
        total,
        page,
        has_more: typeof total === 'number' && typeof data!.offsetEnd === 'number' ? data!.offsetEnd < total : false,
        results,
      };
    },

    async getDocument(o: GetDocumentOpts): Promise<FullDocument> {
      if (o.version) {
        throw new Error(`${SOURCE_ID} serves only the current text; a version ("${o.version}") cannot be fetched.`);
      }
      const { lawId, locationId } = parseDocId(o.doc_id);
      const data = await getJson<LawDocDetail>(`/laws/${lawId}/${encodeURIComponent(locationId)}`, {}, true);
      if (!data) {
        throw new Error(`${SOURCE_ID}: no document "${locationId}" in law ${lawId} (doc_id "${o.doc_id}").`);
      }
      const d = data.result!;
      if (typeof d.text !== 'string') {
        throw new Error(`${SOURCE_ID}: document ${o.doc_id} came back without text.`);
      }
      const text = unescapeNewlines(d.text).trim();
      const max = o.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
      const t = o.truncate !== false ? truncateText(text, max) : { text, truncated: false, full_length_chars: text.length };
      return {
        source_id: SOURCE_ID,
        doc_id: `${lawId}/${locationId}`,
        jurisdiction: JURISDICTION,
        type: 'legislation',
        title: docHeading(d),
        text: t.text,
        date: d.activeDate,
        url: `${VIEWER}/${lawId}/${locationId}`,
        full_length_chars: t.full_length_chars,
        truncated: t.truncated,
        version: d.activeDate,
        metadata: {
          law_id: lawId,
          law_name: d.lawName,
          doc_type: d.docType,
          doc_level_id: d.docLevelId,
          parents: (d.parents ?? []).map((p) => ({ location_id: p.locationId, doc_type: p.docType, doc_level_id: p.docLevelId, title: p.title })),
        },
      };
    },
  };
}
