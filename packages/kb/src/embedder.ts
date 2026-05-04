/**
 * Minimal client for OpenAI-compatible /v1/embeddings endpoints. Works with
 * OpenAI itself, Dashscope (Qwen), Together, Anyscale, and most local
 * gateways (LiteLLM, vLLM) that expose the same shape.
 *
 * Endpoint: POST `${baseUrl}/v1/embeddings`
 * Body:    `{ "model": "...", "input": ["text", ...] }`
 * Returns: `{ "data": [{ "embedding": [..] }, ...] }`
 *
 * No retries, no rate-limiting — keep it simple. Wrap with your own queue if
 * you're embedding huge corpora.
 */
export interface EmbedderConfig {
  /** Base URL of the OpenAI-compatible service. e.g. "https://api.openai.com" */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Embedding dimension produced by the model. Required so the store can
   *  size its vec0 column correctly. Validated on first call. */
  dim: number;
  /** Provider-specific extras merged into the request body. */
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  /** Per-request timeout, default 60s. */
  timeoutMs?: number;
  /**
   * Max inputs per `/v1/embeddings` request. Some providers cap this
   * (Dashscope: 10, OpenAI: 2048). When the caller passes more than this,
   * the embedder splits into sequential batches and concatenates results.
   * Default 10 — safe for every provider we've seen.
   */
  batchSize?: number;
}

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(inputs: string[]): Promise<number[][]>;
}

export function createOpenAIEmbedder(config: EmbedderConfig): Embedder {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 60_000;
  const batchSize = Math.max(1, config.batchSize ?? 10);

  async function embedBatch(inputs: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = {
      ...(config.extraBody ?? {}),
      model: config.model,
      input: inputs,
    };

    const response = await fetchImpl(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Embedding endpoint returned ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = (await response.json()) as { data: { embedding: number[] }[] };
    const vectors = data.data.map((d) => d.embedding);

    for (const v of vectors) {
      if (v.length !== config.dim) {
        throw new Error(
          `Embedding dimension mismatch: model ${config.model} returned ${v.length}, expected ${config.dim}. Update the embedder config.`,
        );
      }
    }
    return vectors;
  }

  return {
    model: config.model,
    dim: config.dim,
    async embed(inputs) {
      if (inputs.length === 0) return [];
      // Sequential batching: providers like Dashscope cap inputs per call,
      // so we slice the list and stitch results back together in order.
      const out: number[][] = [];
      for (let i = 0; i < inputs.length; i += batchSize) {
        const batch = inputs.slice(i, i + batchSize);
        const vectors = await embedBatch(batch);
        out.push(...vectors);
      }
      return out;
    },
  };
}
