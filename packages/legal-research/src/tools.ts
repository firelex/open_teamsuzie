// packages/legal-research/src/tools.ts
import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import type { LegalProvider, SearchOpts, GetDocumentOpts, FindInDocumentOpts } from './types.js';

interface SearchArgs extends SearchOpts {
  source_id: string;
}
interface GetDocumentArgs extends GetDocumentOpts {
  source_id: string;
}
interface FindInDocumentArgs extends FindInDocumentOpts {
  source_id: string;
}

export function buildLegalTools(providers: LegalProvider[]): AnyToolDefinition[] {
  const sourcesById = new Map(providers.map((p) => [p.source_id, p]));
  const sourceList = providers.map((p) => `${p.source_id} (${p.name})`).join(', ');

  const searchTool: AnyToolDefinition = {
    name: 'legal_search',
    description: `Search legal databases by jurisdiction + query. Available sources: ${sourceList || 'none'}.`,
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', enum: providers.map((p) => p.source_id), description: 'Source identifier.' },
        query: { type: 'string' },
        type: { type: 'string', enum: ['legislation', 'case_law'] },
        date_from: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        page: { type: 'integer', minimum: 1 },
      },
      required: ['source_id', 'query'],
      additionalProperties: false,
    },
    async execute(args: SearchArgs) {
      const provider = sourcesById.get(args.source_id);
      if (!provider) throw new Error(`Unknown source_id "${args.source_id}". Available: ${[...sourcesById.keys()].join(', ')}.`);
      return provider.search({
        query: args.query,
        type: args.type,
        date_from: args.date_from,
        date_to: args.date_to,
        page: args.page,
      });
    },
  };

  const getDocumentTool: AnyToolDefinition = {
    name: 'legal_get_document',
    description: `Fetch the full text of a document by source_id + doc_id. Available sources: ${sourceList || 'none'}.`,
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', enum: providers.map((p) => p.source_id) },
        doc_id: { type: 'string' },
        version: { type: 'string' },
        truncate: { type: 'boolean' },
        max_chars: { type: 'integer', minimum: 1 },
      },
      required: ['source_id', 'doc_id'],
      additionalProperties: false,
    },
    async execute(args: GetDocumentArgs) {
      const provider = sourcesById.get(args.source_id);
      if (!provider) throw new Error(`Unknown source_id "${args.source_id}". Available: ${[...sourcesById.keys()].join(', ')}.`);
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
    description: `Find articles inside a long legislation document containing a keyword. Supported sources: ${findSupportedSources.join(', ') || 'none'}.`,
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', enum: findSupportedSources.length > 0 ? findSupportedSources : undefined },
        doc_id: { type: 'string' },
        keyword: { type: 'string', description: 'Keyword or short phrase (case-insensitive).' },
        max_articles: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['source_id', 'doc_id', 'keyword'],
      additionalProperties: false,
    },
    async execute(args: FindInDocumentArgs) {
      const provider = sourcesById.get(args.source_id);
      if (!provider || !provider.findInDocument) {
        throw new Error(`source_id "${args.source_id}" does not support find_in_document. Supported: ${findSupportedSources.join(', ')}.`);
      }
      return provider.findInDocument({ doc_id: args.doc_id, keyword: args.keyword, max_articles: args.max_articles });
    },
  };

  return [searchTool, getDocumentTool, findInDocumentTool];
}
