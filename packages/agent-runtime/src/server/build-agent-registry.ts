import type {
  AgentTargetOverride,
  AgentTargetRegistry,
} from '@teamsuzie/agent-loop';

/**
 * Minimal shape `buildAgentRegistryFromModels` accepts — matches the
 * picker's `ModelOption` (from `@teamsuzie/ui/lib/default-models`) but
 * declared independently so this module doesn't pull in `@teamsuzie/ui`.
 *
 * Only the `id` + `direct: { id, baseUrl }` fields are load-bearing; the
 * rest of `ModelOption` (display labels, pricing, etc.) is irrelevant to
 * routing and is happily ignored by the destructure here.
 */
export interface ModelDirectEntry {
  /** Prefixed UI id stored by the picker, e.g. `openai/gpt-5.5`. */
  id: string;
  /** Wire id + base URL for callers that hit the provider directly. */
  direct?: { id: string; baseUrl: string };
}

export interface BuildAgentRegistryOptions {
  /**
   * Resolve an API key per provider baseUrl. Called once per registered
   * entry at build time. Return `undefined` to omit the apiKey on that
   * entry (the default agent's apiKey wins via `resolveAgentTarget`).
   *
   * Typical usage:
   * ```ts
   * apiKeyFor: (baseUrl) => {
   *   if (baseUrl.includes('openai.com'))   return process.env.OPENAI_API_KEY;
   *   if (baseUrl.includes('anthropic.com')) return process.env.ANTHROPIC_API_KEY;
   *   if (baseUrl.includes('dashscope'))    return process.env.DASHSCOPE_API_KEY;
   *   return undefined;
   * }
   * ```
   */
  apiKeyFor?: (baseUrl: string) => string | undefined;
  /**
   * Resolve per-provider extra-body knobs (e.g. `{enable_thinking:false}`
   * for Qwen). When omitted, the default agent's extraBody is preserved
   * via `resolveAgentTarget`'s merge.
   */
  extraBodyFor?: (baseUrl: string) => Record<string, unknown> | undefined;
}

/**
 * Build an `AgentTargetRegistry` from a model catalog. Each model with a
 * `direct: { id, baseUrl }` block produces a registry entry keyed by the
 * prefixed UI id, with the wire id substituted into `model` and the
 * matching `baseUrl` / `apiKey` / `extraBody` filled in.
 *
 * Pair with `startAgent({ agentRegistry: ... })` so a picker selection
 * that doesn't match the default agent's provider routes correctly
 * instead of sending the prefixed id straight to the wrong provider.
 *
 * Models without a `direct` block are skipped — they can't be routed.
 */
export function buildAgentRegistryFromModels(
  models: ReadonlyArray<ModelDirectEntry>,
  opts: BuildAgentRegistryOptions = {},
): AgentTargetRegistry {
  const registry: AgentTargetRegistry = {};
  for (const m of models) {
    if (!m.direct) continue;
    const override: AgentTargetOverride = {
      model: m.direct.id,
      baseUrl: m.direct.baseUrl,
    };
    const apiKey = opts.apiKeyFor?.(m.direct.baseUrl);
    if (apiKey !== undefined) override.apiKey = apiKey;
    const extraBody = opts.extraBodyFor?.(m.direct.baseUrl);
    if (extraBody !== undefined) override.extraBody = extraBody;
    registry[m.id] = override;
  }
  return registry;
}
