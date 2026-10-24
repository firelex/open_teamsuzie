/**
 * Shared model-gateway types. Deliberately small and provider-neutral: the app
 * and its UI speak in these terms; only the adapters (providers.ts) know the
 * wire shape of a specific provider.
 */

export type ProviderId = 'anthropic' | 'openai' | 'qwen' | 'openai-compatible';

export type Deployment = 'hosted' | 'local';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** A concrete, selectable model surfaced by the gateway. */
export interface ModelInfo {
  /** Stable selector id: `${provider}/${model}`. */
  id: string;
  provider: ProviderId;
  /** The provider's API model id, e.g. `claude-sonnet-5`. */
  model: string;
  /** Human-facing label, e.g. `Claude Sonnet 5`. */
  label: string;
  deployment: Deployment;
  /** True when this model can actually be invoked (key present / runtime reachable). */
  available: boolean;
  /** Why it is unavailable — shown in the picker so the reason is never hidden. */
  reason?: string;
}

/** A caller's request to the gateway. `id` is a ModelInfo.id (`provider/model`). */
export interface ChatRequest {
  /** The selected model's `provider/model` id. */
  id: string;
  messages: ChatMessage[];
  /** Optional cap on generated tokens (providers that need it, e.g. Anthropic). */
  maxTokens?: number;
  /**
   * Set false to turn a model's thinking mode off. Sent as `enable_thinking: false`
   * to Qwen and local OpenAI-compatible runtimes. Anthropic models do not think
   * unless asked, so false is already their behaviour. OpenAI reasoning models
   * cannot turn it off, so false throws for them.
   */
  thinking?: boolean;
  /** Ask for a single JSON object as the reply (OpenAI-format providers only; throws for Anthropic). */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ChatResult {
  provider: ProviderId;
  model: string;
  text: string;
}

/** A reachable local runtime (an already-running OpenAI-compatible server). */
export interface LocalRuntime {
  /** Stable id for display/dedup. */
  id: string;
  label: string;
  /** Base URL, e.g. `http://localhost:1234/v1`. */
  baseUrl: string;
  /** Optional bearer token for the runtime. */
  apiKey?: string;
  /** Model ids the runtime advertises (from its `/models`), or [] if unknown. */
  models: string[];
}

/**
 * Persists the app/tenant's chosen default model — the model workflows use, and
 * the one the Models picker restores. The app supplies the storage (e.g. a
 * tenant-scoped row); the gateway only reads/writes an id string. Omit it and the
 * default is simply the first available model (no persistence).
 */
export interface DefaultModelStore {
  get(): Promise<string | null> | string | null;
  set(id: string): Promise<void> | void;
}

/** Injected env + fetch, so the gateway is testable with no real network. */
export interface GatewayDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Lister for reachable local runtimes; default returns none. */
  listLocalRuntimes?: () => Promise<LocalRuntime[]> | LocalRuntime[];
  /** Persistence for the chosen default model; default is the first available model. */
  defaultModelStore?: DefaultModelStore;
}

/** A function the model may call, described by a JSON Schema for its arguments. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One call the model made: `arguments` is the raw JSON text the model wrote. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A conversation with tool use: the assistant's tool calls and each call's result. */
export type ToolChatMessage =
  | ChatMessage
  | { role: 'assistant'; content: string | null; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolChatRequest {
  id: string;
  messages: ToolChatMessage[];
  /** May be empty: then no tools are sent and the reply is plain text (or JSON with `json`). */
  tools: ToolDefinition[];
  maxTokens?: number;
  thinking?: boolean;
  json?: boolean;
  signal?: AbortSignal;
}

export interface ToolChatResult {
  provider: ProviderId;
  model: string;
  text: string;
  /** The model's reasoning text, when it thought and its runtime sends what it thought; otherwise null. */
  reasoning: string | null;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}
