export { KnowledgeBaseStore } from './store.js';
export type { KnowledgeBaseStoreOptions } from './store.js';

export { chunkMarkdown } from './chunker.js';
export type { Chunk, ChunkerOptions } from './chunker.js';

export { createOpenAIEmbedder } from './embedder.js';
export type { Embedder, EmbedderConfig } from './embedder.js';

export { KB_MIGRATIONS } from './migrations.js';

export { createKbSearchTool } from './tool.js';
export type {
  KbSearchToolDefinition,
  KbSearchToolOptions,
  KbSearchToolResult,
} from './tool.js';

export type { KbDocument, KbChunk, KbSearchHit, KbInsertInput } from './types.js';

export { WorkspaceRag } from './workspace-rag.js';
export type { WorkspaceRagOptions, WorkspaceDocRecord } from './workspace-rag.js';
