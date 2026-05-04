import type { KnowledgeBaseStore } from './store.js';

/**
 * Build a `kb_search` tool definition compatible with `@teamsuzie/agent-loop`.
 * The factory is generic so apps don't have to import the agent-loop types
 * here — pass the resolved tool shape into your tool list.
 *
 * The tool searches the knowledge base and returns the top-K chunks,
 * formatted for the agent's reading.
 */
export interface KbSearchToolOptions {
  store: KnowledgeBaseStore;
  /** Default top-K when the agent doesn't specify. */
  defaultTopK?: number;
  /** Hard cap on top-K so the agent can't accidentally pull a huge result. */
  maxTopK?: number;
  /** Resolve the owner id for the current request. Return null/undefined for
   *  a single-tenant KB where every search sees every doc. */
  getOwnerId?: () => string | null | undefined;
  /** Override the tool name. Defaults to `kb_search`. */
  name?: string;
  /** Override the description. */
  description?: string;
}

export interface KbSearchToolDefinition {
  name: string;
  description: string;
  parameters: object;
  execute: (args: { query: string; top_k?: number }) => Promise<KbSearchToolResult>;
}

export interface KbSearchToolResult {
  query: string;
  hits: {
    document_id: string;
    document_name: string;
    chunk_index: number;
    content: string;
    /** Cosine distance from the vector index. Absent on keyword-only hits. */
    distance?: number;
  }[];
}

export function createKbSearchTool(opts: KbSearchToolOptions): KbSearchToolDefinition {
  const defaultTopK = opts.defaultTopK ?? 5;
  const maxTopK = opts.maxTopK ?? 20;
  return {
    name: opts.name ?? 'kb_search',
    description:
      opts.description ??
      "Semantic search over the user's knowledge base. Use this when answering a question that may be addressed by previously uploaded documents — contracts, memos, policies, prior matters, or any reference material the user has indexed. Returns the most relevant chunks with their parent document name and a distance score (lower = closer).",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The semantic query. Phrase as a natural-language question or topic — not as keywords.',
        },
        top_k: {
          type: 'number',
          description: `How many chunks to return. Default ${defaultTopK}, max ${maxTopK}.`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args) {
      const topK = Math.min(Math.max(1, Math.floor(args.top_k ?? defaultTopK)), maxTopK);
      const ownerId = opts.getOwnerId?.() ?? null;
      const hits = await opts.store.search(args.query, { topK, ownerId });
      return {
        query: args.query,
        hits: hits.map((h) => ({
          document_id: h.document.id,
          document_name: h.document.name,
          chunk_index: h.chunk.chunkIndex,
          content: h.chunk.content,
          distance: h.distance,
        })),
      };
    },
  };
}
