// Common shapes for the unified legal-research surface.
//
// One tool surface, many backends. Each provider implements `search` +
// `getDocument` (and optionally `findInDocument`) against a specific
// jurisdiction's API/HTML, normalizing responses to the shapes below.
//
// The shapes mirror the legal-sources project's normalized schema
// (_id, _source, _type, title, text, date, url) so this code can grow
// to cover more of those sources without re-thinking the surface.

export type DataType = 'legislation' | 'case_law';

export interface SearchHit {
  /** Source identifier in `<COUNTRY>/<Source>` form, e.g. `AR/InfoLEG`. */
  source_id: string;
  /** Provider-specific document ID; round-trip back via `legal_get_document`. */
  doc_id: string;
  /** ISO 3166-1 alpha-2 country code, or `EU`. */
  jurisdiction: string;
  type: DataType;
  title: string;
  snippet?: string;
  /** Publication / decision date, source-native format (often `YYYY-MM-DD` or `DD/MM/YYYY`). */
  date?: string;
  url: string;
  /** Source-specific extras the model might want (norm number, court, ECLI, etc.). */
  metadata?: Record<string, unknown>;
}

export interface SearchResults {
  source_id: string;
  total?: number;
  page: number;
  has_more: boolean;
  results: SearchHit[];
}

export interface SearchOpts {
  query: string;
  type?: DataType;
  date_from?: string;
  date_to?: string;
  page?: number;
}

export interface FullDocument {
  source_id: string;
  doc_id: string;
  jurisdiction: string;
  type: DataType;
  title: string;
  text: string;
  date?: string;
  url: string;
  full_length_chars: number;
  truncated: boolean;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface GetDocumentOpts {
  doc_id: string;
  version?: string;
  truncate?: boolean;
  max_chars?: number;
}

export interface ArticleMatch {
  article_number: string;
  text: string;
}

export interface FindInDocumentResult {
  source_id: string;
  doc_id: string;
  keyword: string;
  matches: ArticleMatch[];
  total_articles: number;
  url: string;
}

export interface FindInDocumentOpts {
  doc_id: string;
  keyword: string;
  max_articles?: number;
}

export interface LegalProvider {
  /** `<COUNTRY>/<Source>`, e.g. `FR/Legifrance`. Stable identifier. */
  source_id: string;
  jurisdiction: string;
  /** Human-readable name for descriptions / errors. */
  name: string;
  data_types: DataType[];
  /** One-line summary of coverage, surfaced in the tool description. */
  summary: string;
  search(opts: SearchOpts): Promise<SearchResults>;
  getDocument(opts: GetDocumentOpts): Promise<FullDocument>;
  /** Optional — only legislation providers with article structure should implement. */
  findInDocument?(opts: FindInDocumentOpts): Promise<FindInDocumentResult>;
}
