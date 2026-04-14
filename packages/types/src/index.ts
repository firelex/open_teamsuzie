/**
 * Shared types for Team Suzie
 */

// =============================================================================
// Multi-Tenancy Types
// =============================================================================

/**
 * Scope levels for multi-tenant data access
 * - global: Platform-wide data accessible to all (admin-curated)
 * - org: Organization-level data shared within an org
 * - agent: Agent-specific training/context data
 * Hierarchy: agent → org → global
 */
export type Scope = 'global' | 'org' | 'agent';

/**
 * A scoped reference identifying the owner of data
 */
export interface ScopeRef {
  scope: Scope;
  scope_id: string | null; // null for global scope
}

/**
 * Base interface for entities with scope
 */
export interface ScopedEntity {
  scope: Scope;
  scope_id: string | null;
}

/**
 * Context for agent requests, containing full hierarchy
 */
export interface AgentContext {
  agent_id: string;
  user_id: string;
  organization_id: string;
  scopes: ScopeRef[]; // Ordered: agent → org → global
}

/**
 * Options for scoped queries
 */
export interface ScopeQueryOptions {
  scopes: ScopeRef[];
  include_global?: boolean;
}

// =============================================================================
// Vector DB Types
// =============================================================================

export interface VectorSearchRequest {
  query: string;
  scopes: ScopeRef[];
  collection?: string;
  limit?: number;
  threshold?: number;
  filters?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  scope: Scope;
  scope_id: string | null;
}

export interface EmbeddingUpsertRequest {
  id?: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  scope: Scope;
  scope_id: string | null;
  collection?: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeBaseIngestRequest {
  content: string;
  source_type: 'file' | 'url' | 'text';
  source_name: string;
  scope: Scope;
  scope_id: string | null;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Graph DB Types
// =============================================================================

export interface GraphEntityRequest {
  type: string;
  name: string;
  properties?: Record<string, unknown>;
  scope: Scope;
  scope_id: string | null;
}

export interface GraphRelationshipRequest {
  from_id: string;
  to_id: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphSearchResult {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  score?: number;
  scope: Scope;
  scope_id: string | null;
}

export interface CypherQueryRequest {
  query: string;
  params?: Record<string, unknown>;
  scopes?: ScopeRef[];
}

export interface NaturalLanguageQueryRequest {
  query: string;
  scopes: ScopeRef[];
}

// =============================================================================
// Tool-related types
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  userId?: string;
  agentContext?: AgentContext;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// =============================================================================
// Persona types
// =============================================================================

export interface PersonaConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  availableTools: string[];
}

// =============================================================================
// Provider types for backend services
// =============================================================================

export type ProviderType = 'vector-db' | 'graph-db';

export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  healthEndpoint?: string;
}

// =============================================================================
// Common API response types
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}
