import type { CellFormat } from './types.js';

export type CoerceResult =
    | { ok: true; value: string }
    | { ok: false; reason: string };

/**
 * Coerce a model's free-form answer into the canonical shape for a given
 * `format`. Pure — no LLM calls, no I/O. Returns `{ok:true, value}` with
 * the canonical string on success, or `{ok:false, reason}` for retry hints.
 *
 * Citation markers (`[N]`) are tolerated and stripped before parsing for
 * structured formats; `text` and `bullets` keep them so chips still render.
 */
export function coerceCellOutput(format: CellFormat, raw: string): CoerceResult {
    if (typeof raw !== 'string') {
        return { ok: false, reason: 'no answer' };
    }
    const trimmed = raw.trim();
    switch (format) {
        case 'text':
            return coerceText(trimmed);
        case 'short_text':
            return coerceShortText(trimmed);
        case 'date':
            return coerceDate(trimmed);
        case 'yes_no':
            return coerceYesNo(trimmed);
        case 'bullets':
            return coerceBullets(raw);
        case 'money':
            return coerceMoney(trimmed);
    }
}

/**
 * Brief instruction telling the model how to fix a coercion failure.
 * Designed to be appended after the model's bad-shape attempt during
 * the retry pass.
 */
export function retryPromptFor(format: CellFormat, reason: string): string {
    const tail = ` Keep your inline citation marker and the citation block.`;
    switch (format) {
        case 'text':
            return `Your previous reply (${reason}) wasn't usable. Please answer again as plain text.${tail}`;
        case 'short_text':
            return `Your previous reply didn't fit a short answer (${reason}). Please reply with a single short phrase — under 20 words, no line breaks.${tail}`;
        case 'date':
            return `Your previous reply (${reason}) wasn't a date. Please answer with the date in YYYY-MM-DD form (e.g. 2025-01-15) — only the date.${tail}`;
        case 'yes_no':
            return `Your previous reply (${reason}) wasn't yes-or-no. Please answer with exactly "Yes" or "No" as the first word.${tail}`;
        case 'bullets':
            return `Your previous reply (${reason}) wasn't a bullet list. Please answer as a markdown bullet list — each item on its own line beginning with "- ".${tail}`;
        case 'money':
            return `Your previous reply (${reason}) wasn't a currency amount. Please answer with a single amount like "$1,500" or "USD 1,500" — no surrounding prose.${tail}`;
    }
}

// --- per-format helpers --------------------------------------------------

function coerceText(s: string): CoerceResult {
    if (s.length === 0) return { ok: false, reason: 'empty answer' };
    return { ok: true, value: s };
}

function coerceShortText(s: string): CoerceResult {
    const collapsed = s.replace(/\s+/g, ' ').trim();
    if (!collapsed) return { ok: false, reason: 'empty answer' };
    if (collapsed.length > 200) {
        return { ok: false, reason: 'answer too long for a short field' };
    }
    return { ok: true, value: collapsed };
}

function stripMarkers(s: string): string {
    return s
        .replace(/\[\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[.,;:!?]+\s*$/, '')
        .trim();
}

// Permissive month list for the long-form date regex below.
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*';

const LONG_FORM_DATE = new RegExp(
    // "January 15, 2025" / "Jan 15 2025"
    `^${MONTH}\\s+\\d{1,2},?\\s+\\d{4}$` +
        '|' +
        // "15 January 2025"
        `^\\d{1,2}\\s+${MONTH}\\s+\\d{4}$`,
    'i',
);

function coerceDate(s: string): CoerceResult {
    const stripped = stripMarkers(s);
    if (!stripped) return { ok: false, reason: 'empty answer' };

    // ISO first — strictest, fastest.
    const iso = stripped.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        const [, y, m, d] = iso;
        if (validYmd(+y!, +m!, +d!)) return { ok: true, value: `${y}-${m}-${d}` };
        return { ok: false, reason: 'date out of range' };
    }

    // Slash dates are ambiguous (DD/MM vs MM/DD) — refuse.
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(stripped)) {
        return { ok: false, reason: 'ambiguous slash date format' };
    }

    // Long-form English. We gate on shape before calling Date.parse because
    // Date.parse is loose enough to extract a year out of "Sometime in 2025".
    if (!LONG_FORM_DATE.test(stripped)) {
        return { ok: false, reason: 'could not parse as date' };
    }
    const ts = Date.parse(stripped);
    if (Number.isNaN(ts)) {
        return { ok: false, reason: 'could not parse as date' };
    }
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return { ok: true, value: `${y}-${mo}-${dd}` };
}

function validYmd(y: number, m: number, d: number): boolean {
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    return y >= 1000 && y <= 9999;
}

function coerceYesNo(s: string): CoerceResult {
    const stripped = stripMarkers(s).toLowerCase();
    if (!stripped) return { ok: false, reason: 'empty answer' };
    if (/^(yes|yeah|yep|y|true|affirmative|correct)\b/.test(stripped)) {
        return { ok: true, value: 'Yes' };
    }
    if (/^(no|nope|n|false|negative|incorrect)\b/.test(stripped)) {
        return { ok: true, value: 'No' };
    }
    return { ok: false, reason: 'expected yes or no' };
}

function coerceBullets(raw: string): CoerceResult {
    const lines = raw.split(/\r?\n/);
    const items: string[] = [];
    for (const line of lines) {
        const m = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
        if (m) items.push(m[1]!.trim());
    }
    if (items.length === 0) {
        return { ok: false, reason: 'no bullet items found' };
    }
    return { ok: true, value: items.map((i) => `- ${i}`).join('\n') };
}

function coerceMoney(s: string): CoerceResult {
    const stripped = stripMarkers(s);
    if (!stripped) return { ok: false, reason: 'empty answer' };
    // <symbol|code> <number> [k|m|b]   OR  <number> [k|m|b] <symbol|code>
    const front = stripped.match(
        /([$€£¥]|USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY)\s*([\d,]+(?:\.\d+)?)\s*([kKmMbB])?/,
    );
    const back = stripped.match(
        /([\d,]+(?:\.\d+)?)\s*([kKmMbB])?\s*([$€£¥]|USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY)/,
    );
    let currency: string;
    let numStr: string;
    let suffix: string | undefined;
    if (front) {
        currency = front[1]!;
        numStr = front[2]!;
        suffix = front[3];
    } else if (back) {
        currency = back[3]!;
        numStr = back[1]!;
        suffix = back[2];
    } else {
        return { ok: false, reason: 'no currency amount found' };
    }
    let num = parseFloat(numStr.replace(/,/g, ''));
    if (!Number.isFinite(num)) return { ok: false, reason: 'invalid number' };
    if (suffix) {
        const mult = suffix.toLowerCase();
        if (mult === 'k') num *= 1_000;
        else if (mult === 'm') num *= 1_000_000;
        else if (mult === 'b') num *= 1_000_000_000;
    }
    const formatted = num.toLocaleString('en-US', { maximumFractionDigits: 2 });
    // Prefix-style for symbol currencies, code-and-space for letters.
    const prefix = /^[$€£¥]$/.test(currency) ? `${currency}` : `${currency} `;
    return { ok: true, value: `${prefix}${formatted}` };
}
