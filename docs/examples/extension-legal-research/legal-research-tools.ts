// Unified legal-research surface.
//
// Three tools, many backends:
//   legal_search          — search by jurisdiction + query
//   legal_get_document    — fetch full text by source_id + doc_id
//   legal_find_in_document — keyword-filter articles inside a long document
//                            (only meaningful for codes/legislation)
//
// To add a new jurisdiction/source: write a provider that implements the
// LegalProvider interface in ./providers/, then register it below.

import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import type { LegalProvider } from './types.js';
import { arInfoleg } from './providers/ar-infoleg.js';
import { buildUsCourtListener } from './providers/us-courtlistener.js';
import { euEurLex } from './providers/eu-eurlex.js';
import { euCuria } from './providers/eu-curia.js';
import { buildFrLegifrance } from './providers/fr-legifrance.js';
import { buildFrJudilibre } from './providers/fr-judilibre.js';
import { esBoe } from './providers/es-boe.js';
import { itNormattiva } from './providers/it-normattiva.js';
import { ukLegislation } from './providers/uk-legislation.js';
import { ukFindCaseLaw } from './providers/uk-findcaselaw.js';
import { deOpenLegalData } from './providers/de-openlegaldata.js';
import { deGesetzeImInternet } from './providers/de-gesetze.js';
import { atRis } from './providers/at-ris.js';
import { chFedlex } from './providers/ch-fedlex.js';
import { coeHudoc } from './providers/coe-hudoc.js';
import { usCfr } from './providers/us-ecfr.js';
import { brPlanalto } from './providers/br-planalto.js';
import { buildInIndianKanoon } from './providers/in-indiankanoon.js';
import { auFederalRegister } from './providers/au-federalregister.js';
import { nlWetten } from './providers/nl-wetten.js';
import { nlRechtspraak } from './providers/nl-rechtspraak.js';
import { ieStatuteBook } from './providers/ie-statutebook.js';
import { caJustice } from './providers/ca-justice.js';
import { beJustel } from './providers/be-justel.js';
import { jpEGov } from './providers/jp-egov.js';
import { mxDof } from './providers/mx-dof.js';

export interface BuildLegalResearchOptions {
  /** CourtListener token. Without it, US searches use the public unauth tier. */
  courtListenerToken?: string;
  courtListenerBaseUrl?: string;
  /** PISTE OAuth2 credentials for FR/Legifrance. Both required to enable FR legislation. */
  pisteClientId?: string;
  pisteClientSecret?: string;
  /** PISTE API key for FR/Judilibre. Required to enable FR case law. */
  judilibreApiKey?: string;
  /** Indian Kanoon API key. Without it, the IN/IndianKanoon provider isn't registered. */
  indianKanoonApiKey?: string;
}

export function buildProviders(opts: BuildLegalResearchOptions = {}): LegalProvider[] {
  const providers: LegalProvider[] = [
    arInfoleg,
    buildUsCourtListener({ token: opts.courtListenerToken, baseUrl: opts.courtListenerBaseUrl }),
    euEurLex,
    euCuria,
    esBoe,
    itNormattiva,
    ukLegislation,
    ukFindCaseLaw,
    deGesetzeImInternet,
    deOpenLegalData,
    atRis,
    usCfr,
    brPlanalto,
    auFederalRegister,
    nlWetten,
    nlRechtspraak,
    ieStatuteBook,
    caJustice,
    beJustel,
    jpEGov,
    mxDof,
    chFedlex,
    coeHudoc,
  ];
  if (opts.pisteClientId && opts.pisteClientSecret) {
    providers.push(buildFrLegifrance({ clientId: opts.pisteClientId, clientSecret: opts.pisteClientSecret }));
  }
  if (opts.judilibreApiKey) {
    providers.push(buildFrJudilibre({ apiKey: opts.judilibreApiKey }));
  }
  if (opts.indianKanoonApiKey) {
    providers.push(buildInIndianKanoon({ apiKey: opts.indianKanoonApiKey }));
  }
  return providers;
}

function describeCoverage(providers: LegalProvider[]): string {
  // Group by jurisdiction → "AR (legislation: AR/InfoLEG), US (case_law: US/CourtListener), …"
  const byJur = new Map<string, LegalProvider[]>();
  for (const p of providers) {
    const list = byJur.get(p.jurisdiction) ?? [];
    list.push(p);
    byJur.set(p.jurisdiction, list);
  }
  const parts: string[] = [];
  for (const [jur, list] of byJur) {
    const sources = list.map((p) => `${p.source_id} [${p.data_types.join('+')}]`).join(', ');
    parts.push(`${jur}: ${sources}`);
  }
  return parts.join(' | ');
}

interface SearchArgs {
  jurisdiction: string;
  query: string;
  type?: 'legislation' | 'case_law';
  source?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}

interface GetDocumentArgs {
  source_id: string;
  doc_id: string;
  version?: string;
  truncate?: boolean;
  max_chars?: number;
}

interface FindInDocumentArgs {
  source_id: string;
  doc_id: string;
  keyword: string;
  max_articles?: number;
}

function selectProviders(
  all: LegalProvider[],
  jurisdiction: string,
  type?: 'legislation' | 'case_law',
  source?: string,
): LegalProvider[] {
  const jur = jurisdiction.toUpperCase();
  let candidates = all.filter((p) => p.jurisdiction === jur);
  if (type) candidates = candidates.filter((p) => p.data_types.includes(type));
  if (source) candidates = candidates.filter((p) => p.source_id === source);
  return candidates;
}

export function buildLegalResearchTools(opts: BuildLegalResearchOptions = {}): AnyToolDefinition[] {
  const providers = buildProviders(opts);
  if (providers.length === 0) return [];

  const coverage = describeCoverage(providers);
  const supportedJurisdictions = [...new Set(providers.map((p) => p.jurisdiction))].sort();
  const sourcesById = new Map(providers.map((p) => [p.source_id, p]));

  const searchTool: AnyToolDefinition = {
    name: 'legal_search',
    description:
      `Search public legal databases for legislation or case law in a given jurisdiction. The tool routes the query to the right backend(s) and returns a unified list of hits with source_id + doc_id you can pass to legal_get_document. Coverage: ${coverage}. ` +
      'For statutory questions, prefer type="legislation"; for court decisions, type="case_law". Some sources support both — leaving type unset searches all relevant sources for the jurisdiction.',
    parameters: {
      type: 'object',
      properties: {
        jurisdiction: {
          type: 'string',
          enum: supportedJurisdictions,
          description: `Jurisdiction code (ISO 3166-1 alpha-2 or "EU"). Supported: ${supportedJurisdictions.join(', ')}.`,
        },
        query: {
          type: 'string',
          description: 'Free-text query. Each backend translates it to its own search syntax.',
        },
        type: {
          type: 'string',
          enum: ['legislation', 'case_law'],
          description: 'Filter to legislation (statutes/codes/regulations) or case law (court decisions).',
        },
        source: {
          type: 'string',
          description: 'Optional override to target a specific source_id (e.g. "AR/InfoLEG"). Skip unless you have a reason.',
        },
        date_from: { type: 'string', description: 'Lower bound on date (YYYY-MM-DD).' },
        date_to: { type: 'string', description: 'Upper bound on date (YYYY-MM-DD).' },
        page: { type: 'integer', minimum: 1, description: 'Result page (default 1).' },
      },
      required: ['jurisdiction', 'query'],
      additionalProperties: false,
    },
    async execute(args: SearchArgs) {
      const candidates = selectProviders(providers, args.jurisdiction, args.type, args.source);
      if (candidates.length === 0) {
        return {
          jurisdiction: args.jurisdiction,
          results: [],
          providers_consulted: [],
          message: `No provider matches jurisdiction="${args.jurisdiction}"${args.type ? ` type="${args.type}"` : ''}${args.source ? ` source="${args.source}"` : ''}. Available: ${coverage}.`,
        };
      }

      const settled = await Promise.allSettled(
        candidates.map((p) =>
          p.search({
            query: args.query,
            type: args.type,
            date_from: args.date_from,
            date_to: args.date_to,
            page: args.page ?? 1,
          }),
        ),
      );

      const merged: { source_id: string; total?: number; has_more: boolean; results: unknown[] }[] = [];
      const errors: { source_id: string; error: string }[] = [];
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const provider = candidates[i];
        if (s.status === 'fulfilled') {
          merged.push({
            source_id: provider.source_id,
            total: s.value.total,
            has_more: s.value.has_more,
            results: s.value.results,
          });
        } else {
          errors.push({
            source_id: provider.source_id,
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      }

      return {
        jurisdiction: args.jurisdiction,
        query: args.query,
        page: args.page ?? 1,
        per_source: merged,
        errors: errors.length > 0 ? errors : undefined,
        providers_consulted: candidates.map((p) => p.source_id),
      };
    },
  };

  const getDocumentTool: AnyToolDefinition = {
    name: 'legal_get_document',
    description:
      `Fetch the full text of a legal document by source_id + doc_id (both come from legal_search hits). Long texts are truncated to ~20k chars by default; pass truncate=false to get the whole thing. Available sources: ${[...sourcesById.keys()].join(', ')}.`,
    parameters: {
      type: 'object',
      properties: {
        source_id: {
          type: 'string',
          enum: [...sourcesById.keys()],
          description: 'Source identifier from a search result, e.g. "AR/InfoLEG".',
        },
        doc_id: { type: 'string', description: 'Document identifier from a search result.' },
        version: {
          type: 'string',
          description: 'Source-specific version (e.g. "consolidated" or "original" for AR/InfoLEG). Default: source\'s preferred version.',
        },
        truncate: { type: 'boolean', description: 'Truncate to max_chars (default true).' },
        max_chars: { type: 'integer', minimum: 1000, description: 'Max chars when truncating. Default 20000.' },
      },
      required: ['source_id', 'doc_id'],
      additionalProperties: false,
    },
    async execute(args: GetDocumentArgs) {
      const provider = sourcesById.get(args.source_id);
      if (!provider) {
        throw new Error(`Unknown source_id "${args.source_id}". Available: ${[...sourcesById.keys()].join(', ')}.`);
      }
      return provider.getDocument({
        doc_id: args.doc_id,
        version: args.version,
        truncate: args.truncate,
        max_chars: args.max_chars,
      });
    },
  };

  const findSupportedSources = providers.filter((p) => typeof p.findInDocument === 'function').map((p) => p.source_id);

  const findInDocumentTool: AnyToolDefinition = {
    name: 'legal_find_in_document',
    description:
      `Find articles inside a long legislation document containing a keyword. Splits the document into articles (Article N / Art. N / ARTÍCULO N) and returns the matches only. Useful for questions like "what does Code civil say about <topic>?" Supported sources: ${findSupportedSources.join(', ') || 'none'}.`,
    parameters: {
      type: 'object',
      properties: {
        source_id: {
          type: 'string',
          enum: findSupportedSources.length > 0 ? findSupportedSources : undefined,
          description: 'Source identifier — must be one that supports article extraction.',
        },
        doc_id: { type: 'string' },
        keyword: { type: 'string', description: 'Keyword or short phrase to match inside articles (case-insensitive).' },
        max_articles: { type: 'integer', minimum: 1, maximum: 20, description: 'Max matching articles to return. Default 5.' },
      },
      required: ['source_id', 'doc_id', 'keyword'],
      additionalProperties: false,
    },
    async execute(args: FindInDocumentArgs) {
      const provider = sourcesById.get(args.source_id);
      if (!provider || !provider.findInDocument) {
        throw new Error(
          `source_id "${args.source_id}" does not support find_in_document. Supported: ${findSupportedSources.join(', ')}.`,
        );
      }
      return provider.findInDocument({
        doc_id: args.doc_id,
        keyword: args.keyword,
        max_articles: args.max_articles,
      });
    },
  };

  return [searchTool, getDocumentTool, findInDocumentTool];
}
