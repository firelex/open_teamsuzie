import type { CellFormat } from '@teamsuzie/grid-review';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ColumnDraftOptions {
  baseUrl: string;
  apiKey: string | undefined;
  /** Model id — typically the cheap "simple" model. */
  model: string;
  /** Provider knobs (Qwen's `enable_thinking: false` lives here). */
  extraBody?: Record<string, unknown>;
  /** Default 15s — drafting one prompt should be much faster. */
  timeoutMs?: number;
}

export interface ColumnDraft {
  prompt: string;
  format: CellFormat;
}

const VALID_FORMATS: ReadonlyArray<CellFormat> = [
  'text',
  'short_text',
  'date',
  'yes_no',
  'bullets',
  'money',
];

const SYSTEM_PROMPT = [
  'You design column prompts for a tabular contract-review tool. Each',
  'column asks one focused question of every document in the review.',
  '',
  'Given a column TITLE (and optionally a format hint), output a JSON',
  'object:',
  '  {"prompt": "...", "format": "..."}',
  '',
  'Rules:',
  '  - "prompt" instructs the assistant on what to extract from the',
  '    document. Make it terse, specific, and self-contained.',
  '  - Don\'t tell the assistant how to cite — citation rules are added',
  '    separately by the runtime.',
  '  - Choose "format" from this enum:',
  '      "text"       — multi-sentence descriptive prose',
  '      "short_text" — a single phrase (e.g. "Delaware", "30 days")',
  '      "date"       — a single date',
  '      "yes_no"     — a yes/no determination',
  '      "bullets"    — a list (one bullet per item)',
  '      "money"      — a currency amount',
  '  - When a format hint is provided, treat it as the user\'s intended',
  '    format and shape the prompt to match. If the hint is "locked",',
  '    you MUST return that exact format. If "soft", prefer it but',
  '    you may override if it\'s clearly wrong for the title.',
  '  - The prompt and format must not contradict each other. If format is',
  '    "bullets", ask for multiple concise items or exactly one bullet;',
  '    never ask for "multiple items" and then "the most significant one"',
  '    in the same prompt. If only one answer is desired, prefer',
  '    "text" or "short_text" unless the format is locked.',
  '  - For "bullets", ask for concise analytical summaries, not full',
  '    clause excerpts. It is okay to ask for labels or classifications',
  '    when they would make the list easier to scan.',
  '  - Include a clear fallback such as "If none are found, answer',
  '    None found."',
  '  - Match the format to what the title is asking when no hint is',
  '    given. "Governing law" → short_text. "Termination triggers" →',
  '    bullets. "Closing date" → date. "Indemnification" → text.',
  '    "Total commitment" → money. "Right of first refusal" → yes_no.',
  '',
  'Output ONLY the JSON object. No prose, no markdown fences.',
].join('\n');

/**
 * Draft a column prompt + format from a user-typed title using the
 * cheap chat model. Used by the review column editor when the user
 * blurs the title input — replaces the static preset pack with a
 * model-generated starter that the user can edit.
 *
 * `formatHint` is the format dropdown's current value; when
 * `formatLocked` is true, the user manually picked it and the model
 * is required to honor it. When false, it's a soft suggestion (often
 * the form's default). The editor enforces the lock even if the model
 * misbehaves, but passing it through as a hint helps the prompt match
 * the format the user actually wants.
 *
 * Throws on transport failure, non-200 response, empty content, or a
 * format value outside the enum. The caller is expected to surface
 * the error and let the user fill the prompt manually.
 */
export async function draftColumnPrompt(
  title: string,
  opts: ColumnDraftOptions & {
    formatHint?: CellFormat;
    formatLocked?: boolean;
  },
): Promise<ColumnDraft> {
  const userParts = [`Column title: ${title}`];
  if (opts.formatHint) {
    const lock = opts.formatLocked ? 'locked' : 'soft';
    userParts.push(`Format hint (${lock}): ${opts.formatHint}`);
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n') },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const response = await fetch(
    `${opts.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages,
        max_tokens: 200,
        temperature: 0.2,
        ...(opts.extraBody ?? {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `column-draft request returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('column-draft returned empty content');

  // Models occasionally wrap JSON in fences despite the instruction.
  const json = stripFences(content);
  let parsed: { prompt?: unknown; format?: unknown };
  try {
    parsed = JSON.parse(json) as { prompt?: unknown; format?: unknown };
  } catch (err) {
    throw new Error(
      `column-draft returned invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
    );
  }
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  const formatRaw =
    typeof parsed.format === 'string' ? parsed.format.trim().toLowerCase() : '';
  if (!prompt) throw new Error('column-draft returned empty prompt');
  if (!VALID_FORMATS.includes(formatRaw as CellFormat)) {
    throw new Error(`column-draft returned invalid format: ${formatRaw}`);
  }
  return { prompt, format: formatRaw as CellFormat };
}

function stripFences(s: string): string {
  // ```json ... ``` or ``` ... ```
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s;
}
