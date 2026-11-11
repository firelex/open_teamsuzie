/**
 * Sensitive-data controls for text bound for an external model.
 *
 * Detection is deterministic pattern matching, with checksums where they
 * exist (IBAN mod-97, card Luhn), so it is predictable and explainable,
 * but it is not a full personal-data classifier: names and addresses are
 * not detected.
 */

export type Category = 'email' | 'phone' | 'iban' | 'card' | 'us_ssn' | 'uk_nino' | 'privilege';

export const CATEGORY_LABEL: Record<Category, string> = {
    email: 'email address',
    phone: 'phone number',
    iban: 'bank account (IBAN)',
    card: 'payment card number',
    us_ssn: 'US Social Security number',
    uk_nino: 'UK National Insurance number',
    privilege: 'privilege marker',
};

/** Categories that are personal data and can be replaced by placeholders. */
export const REDACTABLE: Category[] = ['email', 'phone', 'iban', 'card', 'us_ssn', 'uk_nino'];

export interface Finding {
    category: Category;
    value: string;
    index: number;
}

function luhn(digits: string): boolean {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let d = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
    const iban = raw.replace(/\s/g, '').toUpperCase();
    if (iban.length < 15 || iban.length > 34) return false;
    const moved = iban.slice(4) + iban.slice(0, 4);
    let rem = 0;
    for (const ch of moved) {
        const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
        for (const d of v) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem === 1;
}

const DETECTORS: Array<{ category: Category; re: RegExp; accept?: (m: string) => boolean }> = [
    { category: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { category: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, accept: ibanValid },
    {
        category: 'card',
        re: /\b\d(?:[ -]?\d){12,18}\b/g,
        accept: (m) => {
            const d = m.replace(/\D/g, '');
            return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d);
        },
    },
    { category: 'us_ssn', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
    { category: 'uk_nino', re: /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g },
    {
        // Starts with +, 0 or a bracketed area code; 9 to 15 digits in all.
        category: 'phone',
        re: /(?<![\w+])(?:\+\d{1,3}[ .-]?|\(0?\d{2,5}\) ?|0)\d[\d .-]{6,16}\d(?!\w)/g,
        accept: (m) => {
            const n = m.replace(/\D/g, '').length;
            return n >= 9 && n <= 15;
        },
    },
    {
        category: 'privilege',
        re: /\b(?:privileged\s*(?:&|and)\s*confidential|attorney[- ]client\s+privilege[d]?|legal(?:ly)?\s+(?:advice\s+)?privilege[d]?|litigation\s+privilege|without\s+prejudice|attorney\s+work\s+product)\b/gi,
    },
];

/** Everything sensitive in `text`, in order, without overlaps (earlier detectors win). */
export function detect(text: string, categories?: Category[]): Finding[] {
    const found: Finding[] = [];
    const taken: Array<[number, number]> = [];
    for (const { category, re, accept } of DETECTORS) {
        if (categories && !categories.includes(category)) continue;
        for (const m of text.matchAll(re)) {
            const start = m.index!;
            const end = start + m[0].length;
            if (accept && !accept(m[0])) continue;
            if (taken.some(([s, e]) => start < e && end > s)) continue;
            taken.push([start, end]);
            found.push({ category, value: m[0], index: start });
        }
    }
    return found.sort((a, b) => a.index - b.index);
}

/**
 * Replaces each redactable value with a numbered placeholder such as
 * "[EMAIL 1]". One Redactor keeps the same number for the same value
 * across all the text of a request, so the model can still tell values
 * apart and refer to them.
 */
export class Redactor {
    private readonly seen = new Map<string, string>();
    private readonly counters = new Map<Category, number>();
    readonly counts: Partial<Record<Category, number>> = {};

    redact(text: string): string {
        let out = '';
        let at = 0;
        for (const f of detect(text, REDACTABLE)) {
            const key = `${f.category}:${f.value}`;
            let placeholder = this.seen.get(key);
            if (!placeholder) {
                const n = (this.counters.get(f.category) ?? 0) + 1;
                this.counters.set(f.category, n);
                placeholder = `[${f.category.toUpperCase()} ${n}]`;
                this.seen.set(key, placeholder);
                this.counts[f.category] = (this.counts[f.category] ?? 0) + 1;
            }
            out += text.slice(at, f.index) + placeholder;
            at = f.index + f.value.length;
        }
        return out + text.slice(at);
    }
}

/** "email address" -> "email addresses", "bank account (IBAN)" -> "bank accounts (IBAN)". */
function plural(label: string): string {
    const [head, tail] = label.includes(' (') ? [label.slice(0, label.indexOf(' (')), label.slice(label.indexOf(' ('))] : [label, ''];
    return `${head}${/(s|sh|ch|x)$/.test(head) ? 'es' : 's'}${tail}`;
}

/** "2 email addresses and 1 privilege marker". */
export function describeCounts(counts: Partial<Record<Category, number>>): string {
    const parts = (Object.entries(counts) as Array<[Category, number]>)
        .filter(([, n]) => n > 0)
        .map(([c, n]) => `${n} ${n === 1 ? CATEGORY_LABEL[c] : plural(CATEGORY_LABEL[c])}`);
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export type SensitiveDataMode = 'allow' | 'redact' | 'block';

/** Thrown instead of sending a request that the policy blocks. */
export class SensitiveDataBlockedError extends Error {
    readonly code = 'sensitive_data_blocked';
    constructor(readonly counts: Partial<Record<Category, number>>) {
        super(
            `Not sent: the request contains ${describeCounts(counts)}, and this matter's rules do not allow sensitive data to go to an external model.`,
        );
    }
}

export interface GuardReport {
    mode: SensitiveDataMode;
    counts: Partial<Record<Category, number>>;
}

type Part = { type?: string; text?: unknown };
type Message = { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> };

/** Apply `fn` to every piece of text in OpenAI-style chat messages (content, text parts, tool-call arguments). */
function mapMessageText(messages: Message[], fn: (s: string) => string): Message[] {
    return messages.map((m) => {
        const next: Message = { ...m };
        if (typeof m.content === 'string') next.content = fn(m.content);
        else if (Array.isArray(m.content)) {
            next.content = (m.content as Part[]).map((p) => (typeof p.text === 'string' ? { ...p, text: fn(p.text) } : p));
        }
        if (Array.isArray(m.tool_calls)) {
            next.tool_calls = m.tool_calls.map((c) =>
                c.function && typeof c.function.arguments === 'string'
                    ? { ...c, function: { ...c.function, arguments: fn(c.function.arguments) } }
                    : c,
            );
        }
        return next;
    });
}

/**
 * A fetch for an OpenAI-compatible chat API that applies a sensitive-data
 * policy to every request body's messages before it leaves:
 * - allow: sends as is, but still reports what it found;
 * - redact: replaces personal data with placeholders (privilege markers
 *   cannot be redacted meaningfully and are reported, not changed);
 * - block: throws SensitiveDataBlockedError if anything is found.
 * `onReport` is called once per request that had findings.
 */
export function createGuardedFetch(opts: {
    mode: SensitiveDataMode;
    fetchImpl?: typeof fetch;
    onReport?: (report: GuardReport) => void;
}): typeof fetch {
    const inner = opts.fetchImpl ?? fetch;
    return async (input, init) => {
        if (typeof init?.body !== 'string') return inner(input, init);
        let body: { messages?: Message[] } & Record<string, unknown>;
        try {
            body = JSON.parse(init.body) as typeof body;
        } catch {
            // Not JSON, so not a chat request this guard understands: refuse rather than send unchecked.
            throw new Error('sensitive-data guard: the model request body is not JSON, so it cannot be checked');
        }
        if (!Array.isArray(body.messages)) return inner(input, init);

        const counts: Partial<Record<Category, number>> = {};
        mapMessageText(body.messages, (s) => {
            for (const f of detect(s)) counts[f.category] = (counts[f.category] ?? 0) + 1;
            return s;
        });
        const found = Object.keys(counts).length > 0;
        if (!found) return inner(input, init);
        opts.onReport?.({ mode: opts.mode, counts });
        if (opts.mode === 'block') throw new SensitiveDataBlockedError(counts);
        if (opts.mode === 'allow') return inner(input, init);
        const redactor = new Redactor();
        const redacted = { ...body, messages: mapMessageText(body.messages, (s) => redactor.redact(s)) };
        return inner(input, { ...init, body: JSON.stringify(redacted) });
    };
}
