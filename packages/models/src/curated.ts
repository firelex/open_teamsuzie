import type { ProviderId } from './types.js';

/**
 * The curated hosted models the picker offers. One per provider for now — the
 * label is what the user sees, `model` is the provider API id. Both the model id
 * and label are env-overridable so a provider renaming its API string never
 * requires a code change or blocks sign-in-to-inference.
 *
 * Defaults chosen with the user: Claude Sonnet 5, GPT-5.5, Qwen 3.8-Max.
 */
export interface CuratedModel {
  provider: ProviderId;
  model: string;
  label: string;
}

export function curatedHostedModels(env: NodeJS.ProcessEnv): CuratedModel[] {
  return [
    {
      provider: 'anthropic',
      model: env.MODELS_ANTHROPIC_MODEL || 'claude-sonnet-5',
      label: env.MODELS_ANTHROPIC_LABEL || 'Claude Sonnet 5',
    },
    {
      provider: 'openai',
      model: env.MODELS_OPENAI_MODEL || 'gpt-5.5',
      label: env.MODELS_OPENAI_LABEL || 'GPT-5.5',
    },
    {
      provider: 'qwen',
      model: env.MODELS_QWEN_MODEL || 'qwen3.8-max',
      label: env.MODELS_QWEN_LABEL || 'Qwen 3.8-Max',
    },
  ];
}
