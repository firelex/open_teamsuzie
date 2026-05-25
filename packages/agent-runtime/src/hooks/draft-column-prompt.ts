import type { CellFormat } from '@teamsuzie/grid-review/browser';

const VALID_FORMATS: readonly CellFormat[] = [
    'text',
    'short_text',
    'date',
    'yes_no',
    'bullets',
    'money',
];

function isValidFormat(value: unknown): value is CellFormat {
    return (
        typeof value === 'string' &&
        (VALID_FORMATS as readonly string[]).includes(value)
    );
}

/**
 * Tries to extract a JSON object from `text`. Tolerates a single
 * leading code-fence or stray prose so a slightly chatty LLM response
 * still yields a usable result. Returns null when no parseable object
 * is found.
 */
function extractJsonObject(text: string): Record<string, unknown> | null {
    if (!text) return null;
    const trimmed = text.trim();
    // Strip code fences if present.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    const candidate = fenced ? fenced[1]! : trimmed;
    // Slice to the first object.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/**
 * Drives the `review-column-prompt` AI-draft kind from the client.
 * Calls /api/ai/draft, expects a JSON-shaped response from the LLM,
 * parses it into `{ prompt, format }`. Returns null when no model is
 * configured (manifest.ai.simpleModel undefined → 503) or when the
 * response can't be coerced. Throws on network errors or non-503
 * non-200 statuses so the host UI can surface them.
 *
 * Suzielaw shipped this as a bespoke POST /api/reviews/column/draft-prompt
 * endpoint. The upstream pattern is a kind + the generic /api/ai/draft
 * router — same machinery as workflow-prompt + persona-system + the
 * existing prompt-body kinds.
 */
export async function draftColumnPrompt(input: {
    title: string;
    formatHint: CellFormat;
    formatLocked?: boolean;
    signal?: AbortSignal;
}): Promise<{ prompt: string; format: CellFormat } | null> {
    const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            kind: 'review-column-prompt',
            context: {
                title: input.title,
                formatHint: input.formatHint,
                formatLocked: !!input.formatLocked,
            },
        }),
        signal: input.signal,
    });
    if (res.status === 503) return null;
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Draft failed (${res.status})`);
    }
    const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
    if (!data.ok || typeof data.text !== 'string') {
        throw new Error(data.error || 'Draft response missing fields');
    }
    const parsed = extractJsonObject(data.text);
    if (!parsed) return null;
    const prompt =
        typeof parsed.prompt === 'string' && parsed.prompt.trim().length > 0
            ? parsed.prompt.trim()
            : null;
    if (!prompt) return null;
    // The format hint takes over when the LLM returned an invalid /
    // missing format — never blow up the editor over a bad response.
    const format = isValidFormat(parsed.format)
        ? parsed.format
        : input.formatHint;
    return { prompt, format };
}
