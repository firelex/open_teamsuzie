import type { AgentTargetRegistry } from './resolve-agent.js';

/**
 * A locally-hosted model with both display metadata (used by the model
 * picker UI) and runtime metadata (used to build an `AgentTargetRegistry`
 * from environment variables). Structurally compatible with
 * `@teamsuzie/ui`'s `ModelOption` so the same array can drive both the
 * picker and the server-side routing.
 */
export interface LocalModel {
  /** Model id sent over the wire. */
  id: string;
  name: string;
  provider: string;
  description: string;
  /** Marks this row as locally-hosted in the picker. Always true. */
  local: true;
  /** Link to install / setup instructions (e.g. an unsloth HF page). */
  installUrl: string;
  /** Used to construct env-var names: `${appPrefix}_LOCAL_${envSuffix}_BASE_URL`. */
  envSuffix: string;
  /** Default base URL when the env var is unset. */
  defaultBaseUrl: string;
}

/**
 * Starter set of locally-hosted models the suzie platform supports out of
 * the box. Apps spread this into their model picker alongside `DEFAULT_MODELS`
 * (cloud) and pair it with `buildLocalAgentRegistry` for server-side routing.
 *
 * Default ports are arbitrary but stable — apps can override per-model via
 * env vars if their setup uses different ports.
 */
export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'Qwen/Qwen3.6-35B-A3B',
    name: 'Qwen 3.6 35B-A3B',
    provider: 'Locally hosted',
    description:
      'Mid-size MoE — strong tool use at low active-parameter cost. Run via unsloth on a single GPU.',
    local: true,
    installUrl: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B',
    envSuffix: 'QWEN',
    defaultBaseUrl: 'http://localhost:8801',
  },
  {
    id: 'google/gemma-4-26B-A4B-it',
    name: 'Gemma 4 26B-A4B Instruct',
    provider: 'Locally hosted',
    description:
      'Google open-weight, instruction-tuned. Run via unsloth on a single GPU.',
    local: true,
    installUrl: 'https://huggingface.co/unsloth/gemma-4-26b-a4b-it',
    envSuffix: 'GEMMA',
    defaultBaseUrl: 'http://localhost:8802',
  },
];

/**
 * Read per-model `${prefix}_LOCAL_${envSuffix}_BASE_URL` and
 * `${prefix}_LOCAL_${envSuffix}_API_KEY` from the given env map and produce
 * an `AgentTargetRegistry` keyed by model id. Missing env vars fall back to
 * each model's `defaultBaseUrl` and an undefined api key.
 *
 * Pair with `resolveAgentTarget` on every chat turn so picking a Local model
 * routes to its own endpoint.
 *
 * @example
 * ```ts
 * const registry = buildLocalAgentRegistry(LOCAL_MODELS, process.env, 'SUZIELAW');
 * // registry['Qwen/Qwen3.6-35B-A3B'] === { baseUrl, apiKey }
 * ```
 */
export function buildLocalAgentRegistry(
  models: Pick<LocalModel, 'id' | 'envSuffix' | 'defaultBaseUrl'>[],
  env: Record<string, string | undefined>,
  appPrefix: string,
): AgentTargetRegistry {
  const out: AgentTargetRegistry = {};
  for (const m of models) {
    const baseUrl = (env[`${appPrefix}_LOCAL_${m.envSuffix}_BASE_URL`] || m.defaultBaseUrl).replace(/\/$/, '');
    const apiKey = env[`${appPrefix}_LOCAL_${m.envSuffix}_API_KEY`] || undefined;
    out[m.id] = { baseUrl, apiKey };
  }
  return out;
}
