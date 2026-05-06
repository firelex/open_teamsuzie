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
    /**
     * Minimum share of the requested quote that a prefix match must cover.
     * Defaults to 0.35, which avoids generic lead-ins while still allowing
     * genuine page-boundary prefixes.
     */
    minPrefixCoverage?: number;
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
    const { allowPrefixMatch = true, minPrefixTokens = 6, minPrefixCoverage = 0.35 } = options;

    const normHay = normalizeWithMap(haystack);
    if (normHay.text.length === 0) return null;

    const directMatch = locate(haystack, normHay, needle, false);
    if (directMatch) return directMatch;

    const ellipsisMatch = locateEllipsisSequence(haystack, normHay, needle);
    if (ellipsisMatch) return ellipsisMatch;

    if (!allowPrefixMatch) return null;

    const anchorMatch = locateUniqueTokenWindow(haystack, normHay, needle, minPrefixTokens);
    if (anchorMatch) return anchorMatch;

    const tokens = needle.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length < minPrefixTokens) return null;

    const minCoveredTokens = Math.max(minPrefixTokens, Math.ceil(tokens.length * minPrefixCoverage));
    for (let n = tokens.length - 1; n >= minCoveredTokens; n--) {
        const prefix = tokens.slice(0, n).join(' ');
        const occurrences = countOccurrences(normHay.text, prefix);
        if (occurrences === 1) {
            const match = locate(haystack, normHay, prefix, true);
            if (match) return match;
        }
    }

    return null;
}

function locateUniqueTokenWindow(
    haystack: string,
    normHay: { text: string; map: number[] },
    needle: string,
    minTokens: number,
): HighlightRange | null {
    const tokens = normalizeWithMap(needle).text.split(/\s+/).filter(Boolean);
    if (tokens.length < minTokens) return null;

    const maxWindow = Math.min(tokens.length, 18);
    const candidates: { match: HighlightRange; score: number }[] = [];
    for (let size = maxWindow; size >= minTokens; size--) {
        for (let start = 0; start <= tokens.length - size; start++) {
            const window = tokens.slice(start, start + size).join(' ');
            if (isBoilerplateWindow(window)) continue;
            const occurrences = countOccurrences(normHay.text, window);
            if (occurrences !== 1) continue;
            const match = locate(haystack, normHay, window, true);
            if (match) {
                candidates.push({
                    match,
                    score: distinctivenessScore(match.matchedText) + start * 0.1,
                });
            }
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length === 1) return candidates[0]!.match;
    return candidates[0]!.score > candidates[1]!.score + 2
        ? candidates[0]!.match
        : null;
}

function isBoilerplateWindow(window: string): boolean {
    const normalized = window.replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
    if (!normalized) return true;
    const distinctive = normalized
        .split(/\s+/)
        .filter((token) => token.length >= 5 || /\d|%/.test(token));
    return distinctive.length < 2;
}

function distinctivenessScore(text: string): number {
    return normalizeWithMap(text).text
        .split(/\s+/)
        .filter(Boolean)
        .reduce((score, token) => {
            if (/\d|%/.test(token)) return score + 3;
            if (token.length >= 10) return score + 3;
            if (token.length >= 7) return score + 2;
            if (token.length >= 5) return score + 1;
            return score;
        }, 0);
}

function locateEllipsisSequence(
    haystack: string,
    normHay: { text: string; map: number[] },
    needle: string,
): HighlightRange | null {
    const rawParts = needle
        .split(/(?:\.{3,}|…)/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (rawParts.length < 2) return null;

    const parts = rawParts
        .map((raw) => normalizeWithMap(raw).text)
        // Very short fragments like ")" or "," are not useful anchors.
        .filter((text) => tokenCount(text) >= 3 || text.length >= 24);
    if (parts.length < 2) return null;

    type Candidate = { start: number; end: number };
    const candidates: Candidate[] = [];
    for (const startIdx of allIndexesOf(normHay.text, parts[0]!)) {
        let cursor = startIdx + parts[0]!.length;
        let endIdx = cursor;
        let ok = true;
        for (let i = 1; i < parts.length; i++) {
            const nextIdx = normHay.text.indexOf(parts[i]!, cursor);
            if (nextIdx < 0) {
                ok = false;
                break;
            }
            cursor = nextIdx + parts[i]!.length;
            endIdx = cursor;
        }
        if (ok) candidates.push({ start: startIdx, end: endIdx });
    }
    if (candidates.length !== 1) return null;

    const candidate = candidates[0]!;
    const start = normHay.map[candidate.start]!;
    const end = normHay.map[candidate.end - 1]! + 1;
    return {
        start,
        end,
        matchedText: haystack.slice(start, end),
        prefix: false,
    };
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

function allIndexesOf(haystack: string, needle: string): number[] {
    const out: number[] = [];
    if (!needle) return out;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx < 0) break;
        out.push(idx);
        from = idx + Math.max(1, needle.length);
    }
    return out;
}

function tokenCount(s: string): number {
    return s.split(/\s+/).filter(Boolean).length;
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
