/**
 * Canonical model catalog — shared between the React `ModelPicker` (client)
 * and any server that needs to route picker selections to the right
 * provider (via `resolveAgentTarget` + an `AgentTargetRegistry`).
 *
 * This file deliberately has zero React imports so it can be pulled into
 * Node/tsx contexts (e.g. an Express server building its registry from
 * `DEFAULT_MODELS`). The TSX `model-picker.tsx` re-exports the types and
 * the constant so existing client imports keep working.
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** Free-form note to display under the price (e.g. "approximate; see provider"). */
  note?: string;
}

export interface ModelOption {
  /** Model id sent to the chat backend (e.g. "qwen3.6-plus", "anthropic/claude-sonnet-4-6").
   *  This is the id understood by the agent-runtime's prefix-routed chat
   *  endpoint, where provider routing happens server-side. */
  id: string;
  /** Display name. */
  name: string;
  /** Provider label (e.g. "Anthropic", "Alibaba (Dashscope)"). */
  provider: string;
  /** One-line description shown under the name. */
  description?: string;
  pricing?: ModelPricing;
  /** Optional link to provider pricing page. */
  pricingUrl?: string;
  /** Marks this as a locally-hosted model — surfaces a "Local" badge and
   *  hides cloud-style pricing in favor of the install link. */
  local?: boolean;
  /** Link to install / setup instructions (e.g. an unsloth HF page). Shown
   *  in place of `pricingUrl` for local models. */
  installUrl?: string;
  /** For local models: the base URL the server will route this model's chat
   *  calls to. Display-only — set by the consumer from `/api/health` so the
   *  user can verify the configured endpoint matches where their server runs. */
  resolvedBaseUrl?: string;
  /** Configuration for callers that talk DIRECTLY to the provider's API
   *  instead of going through a prefix router. The agent-runtime's
   *  `createChatRouter` builds its `AgentTargetRegistry` from these
   *  fields so picker selections route to the right provider.
   *
   *  `id` is the raw model id the provider's `/v1/chat/completions`
   *  expects (e.g. `gpt-5.5`, not `openai/gpt-5.5`). `baseUrl` omits the
   *  `/v1` path — agent-loop appends it. */
  direct?: { id: string; baseUrl: string };
}

/**
 * Starter model list — frontier-grade options spanning a wide cost band.
 * Apps free to override or extend. Pricing values are approximate; the
 * `pricingUrl` points at the provider's actual pricing page.
 */
const DASHSCOPE_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode';

export const DEFAULT_MODELS: ModelOption[] = [
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    description: 'Strong on tool use, long-form drafting, and structured output.',
    pricing: { inputPer1M: 3, outputPer1M: 15, note: 'approx.' },
    pricingUrl: 'https://www.anthropic.com/pricing',
    direct: { id: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com' },
  },
  {
    id: 'openai/gpt-5.5',
    name: 'GPT-5.5',
    provider: 'OpenAI',
    description: 'Reliable at structured tool use; broadly available.',
    pricing: { inputPer1M: 2.5, outputPer1M: 10, note: 'approx.' },
    pricingUrl: 'https://openai.com/api/pricing/',
    direct: { id: 'gpt-5.5', baseUrl: 'https://api.openai.com' },
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen 3.7-Max',
    provider: 'Alibaba (Dashscope)',
    description: 'Higher-tier Qwen — better at long tool-call chains than 3.6-Plus.',
    pricing: { inputPer1M: 2.4, outputPer1M: 9.6, note: 'approx.' },
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/billing-of-model-studio',
    direct: { id: 'qwen3.7-max', baseUrl: DASHSCOPE_BASE },
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen 3.6-Plus',
    provider: 'Alibaba (Dashscope)',
    description: 'Strong reasoning at a fraction of the cost of US frontier models.',
    pricing: { inputPer1M: 0.4, outputPer1M: 1.2, note: 'approx.' },
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/billing-of-model-studio',
    direct: { id: 'qwen3.6-plus', baseUrl: DASHSCOPE_BASE },
  },
];
