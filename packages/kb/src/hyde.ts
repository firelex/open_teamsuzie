interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Default format-hint map. Keys match `@teamsuzie/grid-review`'s
 * `CellFormat` union so suzielaw's reviews-glue can pass `column.format`
 * directly. Callers in other domains (Q-log answers, free-form
 * completions) can supply their own map via `HydeOptions.formatHints`.
 */
export const DEFAULT_HYDE_FORMAT_HINTS: Record<string, string> = {
  text: 'Write a paraphrased sentence answer in the same register as the source.',
  short_text: 'Write a short, fragmentary answer (e.g. "Delaware", "30 days", "Yes").',
  date: 'Phrase as "[Topic] on/from [date]" with a plausible date.',
  yes_no: 'Phrase as a "Yes, ..." or "No, ..." sentence with brief context.',
  bullets: 'Write the first plausible bullet of an answer list (one item).',
  money: 'Phrase as "[Topic] is $X" with a plausible currency amount.',
};

export interface HydeOptions {
  /** Endpoint base URL (OpenAI-compatible). */
  baseUrl: string;
  apiKey: string | undefined;
  /** Model id — typically the cheaper "simple" model. */
  model: string;
  /**
   * Provider-specific knobs merged into the request body. Critically, on
   * Dashscope this is where `{"enable_thinking": false}` lives — without
   * it Qwen3 burns 20s+ in its reasoning phase before producing the
   * one-sentence hypothetical, blowing past our timeout.
   */
  extraBody?: Record<string, unknown>;
  /** Per-request timeout, default 20s. HyDE should be quick. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Override the format-hint map. Defaults to `DEFAULT_HYDE_FORMAT_HINTS`.
   * If the resolved `formatKey` is missing from the map, falls back to
   * the `text` hint.
   */
  formatHints?: Record<string, string>;
}

/**
 * Generate a one-sentence hypothetical answer to the user's question —
 * the HyDE technique. The hypothetical is then embedded for retrieval;
 * it lives in the same semantic space as the source document, so the
 * embedder finds the relevant passage more reliably than a question
 * embedding would.
 *
 * The model invents content. That's fine — the output is never shown to
 * the user as an answer; it's a retrieval probe.
 *
 * Extracted from suzielaw 2026-05-17 to sit alongside `WorkspaceRag` so
 * any RAG consumer (suzielaw reviews, diligence Triage, diligence Q-log
 * auto-answer) can use one implementation.
 */
export async function rewriteQueryAsHypothetical(
  question: string,
  formatKey: string,
  opts: HydeOptions,
): Promise<string> {
  const hints = opts.formatHints ?? DEFAULT_HYDE_FORMAT_HINTS;
  const formatHint =
    hints[formatKey] ?? hints.text ?? DEFAULT_HYDE_FORMAT_HINTS.text!;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You generate ONE hypothetical sentence that mimics how the answer to a',
        'question might appear in a contract, side letter, report, or similar',
        'source document. The sentence is used for semantic search retrieval, not',
        'shown to the user. Do not say "I do not know" or hedge — invent a',
        'plausible answer in the formal voice of the source text.',
        '',
        'Rules:',
        '  - Output ONE sentence. No preamble, no quotes, no markdown.',
        '  - Match the style of source-document prose.',
        "  - Don't restate the question; phrase as if it were the actual",
        '    answer in the document.',
        '',
        `Format hint for this question: ${formatHint}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Question: ${question}`,
    },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const response = await (opts.fetchImpl ?? fetch)(
    `${opts.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages,
        // Keep it short — one sentence is enough for retrieval.
        max_tokens: 120,
        temperature: 0.2,
        ...(opts.extraBody ?? {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `HyDE request returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = (await response.json()) as typeof data;
  } catch (err) {
    throw new Error(
      `HyDE response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('HyDE returned empty content');
  // Strip surrounding quotes the model sometimes adds despite the
  // instruction. Take only the first sentence to keep the embedding tight.
  return firstSentence(stripWrappingQuotes(content));
}

function stripWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.!?\n]+[.!?]/);
  if (m) return m[0].trim();
  return s.trim();
}
