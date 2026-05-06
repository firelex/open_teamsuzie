import type { AgentTarget } from './chat-provider.js';

/**
 * Per-model overrides — same shape as `AgentTarget` but every field is
 * optional. Anything unset falls back to the default agent. Most common case:
 * a different `baseUrl` (and possibly `apiKey` / `extraBody`) for locally
 * hosted models that don't run on the same OpenAI-compatible gateway.
 */
export type AgentTargetOverride = Partial<AgentTarget>;

/**
 * Map of model id → optional agent overrides. Apps populate this at startup
 * from env or a config file:
 *
 * ```ts
 * const registry: AgentTargetRegistry = {
 *   'Qwen/Qwen3.6-35B-A3B': { baseUrl: 'http://localhost:8801', apiKey: '' },
 *   'google/gemma-4-26B-A4B-it': { baseUrl: 'http://localhost:8802', apiKey: '' },
 * };
 * ```
 */
export type AgentTargetRegistry = Record<string, AgentTargetOverride>;

/**
 * Resolve the right `AgentTarget` for a model id. If the registry has an
 * entry for this model, merge its overrides on top of the default; otherwise
 * return the default with the requested model id substituted in. Either way
 * the returned target's `model` field is the requested id.
 *
 * This is the core routing primitive for apps that mix cloud and local
 * models — pick a model in the UI, send the id to the server, server runs
 * `resolveAgentTarget(id, registry, defaultAgent)` and uses the result.
 */
export function resolveAgentTarget(
  modelId: string | undefined,
  registry: AgentTargetRegistry,
  defaultAgent: AgentTarget,
): AgentTarget {
  const requested = modelId?.trim();
  const base: AgentTarget = requested ? { ...defaultAgent, model: requested } : { ...defaultAgent };
  if (!requested) return base;
  const override = registry[requested];
  if (!override) return base;
  return {
    ...base,
    ...override,
    // The override may set `model` to a "wire" id (e.g. `claude-sonnet-4-6`)
    // when the picker uses a prefixed UI id (e.g. `anthropic/claude-sonnet-4-6`).
    // Without this, the prefixed id would land in the request body and the
    // provider would 404 it. Falls back to the requested id when not overridden.
    model: override.model ?? requested,
    // Merge `extraBody` shallowly — typical pattern is per-model knobs.
    extraBody: override.extraBody ?? base.extraBody,
  };
}
