import { normalizeWithMap } from './normalize.js';

export type HighlightRange = {
    start: number;
    end: number;
    matchedText: string;
    /**
     * If true, the matched span is a prefix of the requested needle (the
     * caller should treat this as a best-effort match for a multi-page
     * quote, where the tail of the quote falls outside the haystack).
     */
    prefix: boolean;
};

export type FindHighlightRangeOptions = {
    /**
     * If the full needle is not found, retry with progressively shorter
     * prefixes (token-by-token) until a uniquely-matching prefix is found
     * or only the minimum-token prefix remains. Defaults to true.
     */
    allowPrefixMatch?: boolean;
    /**
     * Minimum number of tokens (whitespace-separated) required to accept a
     * prefix match. Defaults to 6. Higher numbers reduce false positives
     * from generic short phrases like "the General Partner".
     */
    minPrefixTokens?: number;
};

/**
 * Locate `needle` inside `haystack` with drift tolerance (smart quotes,
 * en/em dashes, NBSP, whitespace collapse) and return the offsets in the
 * original (un-normalized) `haystack`.
 *
 * On a full-needle miss with `allowPrefixMatch: true`, walks decreasing
 * token prefixes from longest to shortest and returns the first prefix
 * that occurs **exactly once** in the haystack. Multi-occurrence prefixes
 * are skipped — we'd rather return null than highlight the wrong span.
 * Generic short prefixes (below `minPrefixTokens`) are also skipped.
 */
export function findHighlightRange(
    haystack: string,
    needle: string,
    options: FindHighlightRangeOptions = {},
): HighlightRange | null {
    const { allowPrefixMatch = true, minPrefixTokens = 6 } = options;

    const normHay = normalizeWithMap(haystack);
    if (normHay.text.length === 0) return null;

    const directMatch = locate(haystack, normHay, needle, false);
    if (directMatch) return directMatch;

    if (!allowPrefixMatch) return null;

    const tokens = needle.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length < minPrefixTokens) return null;

    for (let n = tokens.length - 1; n >= minPrefixTokens; n--) {
        const prefix = tokens.slice(0, n).join(' ');
        const occurrences = countOccurrences(normHay.text, prefix);
        if (occurrences === 1) {
            const match = locate(haystack, normHay, prefix, true);
            if (match) return match;
        }
    }

    return null;
}

function locate(
    haystack: string,
    normHay: { text: string; map: number[] },
    needle: string,
    prefix: boolean,
): HighlightRange | null {
    const normNeedle = normalizeWithMap(needle).text;
    if (normNeedle.length === 0) return null;

    const idx = normHay.text.indexOf(normNeedle);
    if (idx < 0) return null;

    const start = normHay.map[idx]!;
    const end = normHay.map[idx + normNeedle.length - 1]! + 1;
    return { start, end, matchedText: haystack.slice(start, end), prefix };
}

function countOccurrences(normHay: string, needle: string): number {
    const normNeedle = normalizeWithMap(needle).text;
    if (normNeedle.length === 0) return 0;
    let count = 0;
    let from = 0;
    while (true) {
        const idx = normHay.indexOf(normNeedle, from);
        if (idx < 0) break;
        count += 1;
        from = idx + normNeedle.length;
    }
    return count;
}
