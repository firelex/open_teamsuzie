import { curatedHostedModels } from './curated.js';
import { hostedProviders, streamChat, chatOnce, type ProviderConfig } from './providers.js';
import type {
  ChatRequest,
  ChatResult,
  GatewayDeps,
  LocalRuntime,
  ModelInfo,
  ProviderId,
} from './types.js';

const DEFAULT_MAX_TOKENS = 2048;

/**
 * The real model gateway. Replaces the scaffold's UnconfiguredModelGateway stub.
 *
 * - Reads provider API keys from the ENVIRONMENT (inherited from the parent
 *   harness) — the app never asks the user for a key; the picker just selects a
 *   model. Missing keys surface as an unavailable model with a visible reason.
 * - Surfaces curated hosted models + any reachable local runtimes (injected).
 * - `stream()` / `chat()` perform real inference through the provider adapters.
 */
export class ModelGateway {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly listLocal: () => Promise<LocalRuntime[]> | LocalRuntime[];

  constructor(deps: GatewayDeps = {}) {
    this.env = deps.env ?? process.env;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.listLocal = deps.listLocalRuntimes ?? (() => []);
  }

  /** Which hosted providers have a key present (with a reason when not). */
  availableProviders(): { provider: ProviderId; available: boolean; reason?: string }[] {
    return Object.values(hostedProviders(this.env)).map((c) => {
      const has = !!(c.keyEnv && this.env[c.keyEnv]);
      return {
        provider: c.id,
        available: has,
        reason: has ? undefined : `No ${c.keyEnv} in the environment`,
      };
    });
  }

  /** True once at least one hosted provider key is present. */
  isConfigured(): boolean {
    return this.availableProviders().some((p) => p.available);
  }

  /** Human-readable setup guidance shown while unconfigured. */
  describeSetup(): string {
    if (this.isConfigured()) return 'Model gateway ready.';
    const missing = this.availableProviders()
      .filter((p) => !p.available)
      .map((p) => p.reason)
      .filter((r): r is string => !!r);
    return `No models available. The parent app has no provider API keys configured (${missing.join('; ')}).`;
  }

  /** The selectable catalogue: curated hosted models + reachable local runtimes. */
  async listModels(): Promise<ModelInfo[]> {
    const hosted = hostedProviders(this.env);
    const curated = curatedHostedModels(this.env).map((m): ModelInfo => {
      const cfg = hosted[m.provider as 'anthropic' | 'openai' | 'qwen'];
      const has = !!(cfg?.keyEnv && this.env[cfg.keyEnv]);
      return {
        id: `${m.provider}/${m.model}`,
        provider: m.provider,
        model: m.model,
        label: m.label,
        deployment: 'hosted',
        available: has,
        reason: has ? undefined : `No ${cfg?.keyEnv} — set it in the parent app`,
      };
    });

    const runtimes = await this.listLocal();
    const local: ModelInfo[] = runtimes.flatMap((rt) =>
      (rt.models.length ? rt.models : ['default']).map((model) => ({
        id: `openai-compatible/${rt.id}:${model}`,
        provider: 'openai-compatible' as const,
        model,
        label: `${rt.label} · ${model}`,
        deployment: 'local' as const,
        available: true,
      })),
    );

    return [...curated, ...local];
  }

  /** Real streaming inference. Yields text deltas. Throws if the model can't be resolved/keyed. */
  async *stream(req: ChatRequest): AsyncIterable<string> {
    const { config, apiKey, model } = await this.resolve(req.id);
    yield* streamChat({
      config,
      apiKey,
      model,
      messages: req.messages,
      maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      fetchImpl: this.fetchImpl,
      signal: req.signal,
    });
  }

  /** Real non-streaming inference. */
  async chat(req: ChatRequest): Promise<ChatResult> {
    const { config, apiKey, model } = await this.resolve(req.id);
    const text = await chatOnce({
      config,
      apiKey,
      model,
      messages: req.messages,
      maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      fetchImpl: this.fetchImpl,
      signal: req.signal,
    });
    return { provider: config.id, model, text };
  }

  /** Resolve a `provider/model` id (or `openai-compatible/<runtime>:<model>`) to a callable config. */
  private async resolve(id: string): Promise<{ config: ProviderConfig; apiKey?: string; model: string }> {
    const slash = id.indexOf('/');
    if (slash < 0) throw new Error(`Invalid model id: ${id}`);
    const provider = id.slice(0, slash) as ProviderId;
    const rest = id.slice(slash + 1);

    if (provider === 'openai-compatible') {
      const colon = rest.indexOf(':');
      const runtimeId = colon >= 0 ? rest.slice(0, colon) : rest;
      const model = colon >= 0 ? rest.slice(colon + 1) : 'default';
      const runtime = (await this.listLocal()).find((r) => r.id === runtimeId);
      if (!runtime) throw new Error(`Local runtime not reachable: ${runtimeId}`);
      return {
        config: { id: 'openai-compatible', format: 'openai', baseUrl: runtime.baseUrl },
        apiKey: runtime.apiKey,
        model,
      };
    }

    const cfg = hostedProviders(this.env)[provider as 'anthropic' | 'openai' | 'qwen'];
    if (!cfg) throw new Error(`Unknown provider: ${provider}`);
    const apiKey = cfg.keyEnv ? this.env[cfg.keyEnv] : undefined;
    if (!apiKey) {
      throw new Error(`No ${cfg.keyEnv} configured — cannot call ${provider}. Set it in the parent app.`);
    }
    return { config: cfg, apiKey, model: rest };
  }
}
