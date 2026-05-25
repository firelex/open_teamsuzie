// AU/FederalRegister — Australian federal legislation via the Federal
// Register of Legislation OData API (api.prod.legislation.gov.au).
//
// Search: GET /v1/titles?$filter=contains(name,'X')&$top=N → JSON metadata
// Fetch:  GET /v1/Documents?$filter=titleId eq 'ID' → list document
//         versions (Word, EPUB, PDF). Pick EPUB and download via
//         /v1/documents(titleid='X',start=...,...,format='Epub') — returns
//         a zip; extract OEBPS/document_*.html and strip tags.

import {
  fetchJson,
  stripHtml,
  truncateText,
  readZipEntries,
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

const API = 'https://api.prod.legislation.gov.au';
const VIEWER = 'https://www.legislation.gov.au';

interface Title {
  id: string;
  name: string;
  collection?: string;
  status?: string;
  isInForce?: boolean;
  isPrincipal?: boolean;
  makingDate?: string;
  year?: number;
}

interface DocumentVersion {
  titleId: string;
  start: string;
  retrospectiveStart: string;
  rectificationVersionNumber: number;
  type: string;
  uniqueTypeNumber: number;
  volumeNumber: number;
  format: string; // "Word", "Epub", "Pdf", ...
  compilationNumber?: string;
}

function odataParam(key: string, value: string): string {
  return `${key}=${encodeURIComponent(value)}`;
}

function isoNoMs(s: string): string {
  // OData expects "2000-02-29T00:00:00" (no milliseconds, no trailing Z) in
  // the path-segment-bound form used by the document endpoint.
  return s.replace(/\..*$/, '').replace(/Z$/, '');
}

export const auFederalRegister: LegalProvider = {
  source_id: 'AU/FederalRegister',
  jurisdiction: 'AU',
  name: 'Federal Register of Legislation (Australia)',
  data_types: ['legislation'],
  summary:
    'Australian federal Acts and Legislative Instruments via the official Federal Register OData API. Search filters titles by name (contains); fetch downloads the EPUB form and extracts XHTML body. doc_id is the title register id (e.g. "C2004A00594"). English.',

  async search(opts: SearchOpts): Promise<SearchResults> {
    if (opts.type && opts.type !== 'legislation') {
      return { source_id: 'AU/FederalRegister', page: opts.page ?? 1, has_more: false, results: [] };
    }
    const page = opts.page ?? 1;
    const top = 10;
    const skip = (page - 1) * top;
    const filterTerms = [
      `contains(tolower(name),'${opts.query.toLowerCase().replace(/'/g, "''")}')`,
    ];
    if (opts.date_from) filterTerms.push(`makingDate ge ${opts.date_from}T00:00:00Z`);
    if (opts.date_to) filterTerms.push(`makingDate le ${opts.date_to}T23:59:59Z`);
    const filter = filterTerms.join(' and ');
    const url = `${API}/v1/titles?${odataParam('$filter', filter)}&${odataParam('$top', String(top))}&${odataParam('$skip', String(skip))}&${odataParam('$count', 'true')}`;
    const data = await fetchJson<{ value?: Title[]; '@odata.count'?: number }>(url);
    const results: SearchHit[] = (data.value ?? []).map((t) => ({
      source_id: 'AU/FederalRegister',
      doc_id: t.id,
      jurisdiction: 'AU',
      type: 'legislation',
      title: t.name,
      date: t.makingDate?.slice(0, 10),
      url: `${VIEWER}/${t.id}`,
      metadata: {
        register_id: t.id,
        collection: t.collection,
        status: t.status,
        in_force: t.isInForce,
        principal: t.isPrincipal,
        year: t.year,
      },
    }));
    return {
      source_id: 'AU/FederalRegister',
      total: data['@odata.count'],
      page,
      has_more: data['@odata.count'] !== undefined && skip + results.length < data['@odata.count'],
      results,
    };
  },

  async getDocument(opts: GetDocumentOpts): Promise<FullDocument> {
    // Step 1: find an EPUB document version for this title.
    const docsUrl = `${API}/v1/Documents?${odataParam('$filter', `titleId eq '${opts.doc_id}' and type eq 'Primary' and format eq 'Epub'`)}&${odataParam('$top', '1')}&${odataParam('$orderby', 'start desc')}`;
    const docsResp = await fetchJson<{ value?: DocumentVersion[] }>(docsUrl);
    let version = docsResp.value?.[0];
    let format: 'Epub' | 'Word' = 'Epub';
    if (!version) {
      // Fall back to Word if no EPUB exists (older acts).
      const wordUrl = `${API}/v1/Documents?${odataParam('$filter', `titleId eq '${opts.doc_id}' and type eq 'Primary' and format eq 'Word'`)}&${odataParam('$top', '1')}&${odataParam('$orderby', 'start desc')}`;
      const wordResp = await fetchJson<{ value?: DocumentVersion[] }>(wordUrl);
      version = wordResp.value?.[0];
      format = 'Word';
    }
    if (!version) {
      throw new Error(`No primary document found for AU title "${opts.doc_id}".`);
    }

    // Step 2: download the binary. URL parameters use lowercase keys (per
    // legal-sources reference impl).
    const start = isoNoMs(version.start);
    const retro = isoNoMs(version.retrospectiveStart);
    const downloadUrl =
      `${API}/v1/documents(` +
      `titleid='${version.titleId}',` +
      `start=${start},` +
      `retrospectivestart=${retro},` +
      `rectificationversionnumber=${version.rectificationVersionNumber},` +
      `type='${version.type}',` +
      `uniqueTypeNumber=${version.uniqueTypeNumber},` +
      `volumeNumber=${version.volumeNumber},` +
      `format='${format}'` +
      `)`;
    const r = await fetch(downloadUrl, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!r.ok) {
      throw new Error(`AU document download ${r.status} for ${opts.doc_id} (${format}).`);
    }
    const buf = Buffer.from(await r.arrayBuffer());

    // Step 3: extract text. EPUB is zip-of-XHTML; Word ".doc" we can't decode
    // without antiword, so we surface a graceful error.
    let extracted = '';
    if (format === 'Epub') {
      try {
        const entries = readZipEntries(buf);
        const htmlEntries = entries.filter(
          (e) => e.name.endsWith('.html') || e.name.endsWith('.xhtml'),
        );
        extracted = htmlEntries
          .map((e) => stripHtml(e.data.toString('utf8')))
          .join('\n\n')
          .trim();
      } catch (err) {
        throw new Error(`Failed to parse AU EPUB for ${opts.doc_id}: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      // Legacy .doc — return a friendly message; the model can still surface
      // the URL for the user to click through.
      extracted = `[AU document is in legacy Word .doc binary format which can't be decoded inline. View at ${VIEWER}/${opts.doc_id}.]`;
    }

    const max = opts.max_chars ?? DEFAULT_MAX_TEXT_CHARS;
    const t = opts.truncate !== false ? truncateText(extracted, max) : { text: extracted, truncated: false, full_length_chars: extracted.length };
    return {
      source_id: 'AU/FederalRegister',
      doc_id: opts.doc_id,
      jurisdiction: 'AU',
      type: 'legislation',
      title: opts.doc_id,
      text: t.text,
      date: version.start.slice(0, 10),
      url: `${VIEWER}/${opts.doc_id}`,
      full_length_chars: t.full_length_chars,
      truncated: t.truncated,
      version: format,
      metadata: { register_id: opts.doc_id, format, download_url: downloadUrl },
    };
  },
};
