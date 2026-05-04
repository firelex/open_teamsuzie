/**
 * Containment-weighted similarity on word-token multisets.
 *
 * Combines two signals:
 *
 *   containment = overlap / min(|A|, |B|)
 *     → 1.0 when the shorter text is fully contained in the longer one.
 *       A paragraph that's a clean subset of a longer one (the long side
 *       has extra clauses) scores ~1.0 instead of the ~0.76 plain Dice
 *       gives. The shorter text IS represented; it's just shorter.
 *
 *   dice = 2 * overlap / (|A| + |B|)
 *     → penalizes length asymmetry. Useful for catching paraphrases but
 *       over-penalizes legitimate "one side has extra content" cases.
 *
 * Final score: 0.7 * containment + 0.3 * dice. Plus a small token-LCS
 * boost when a short paragraph appears, in order, inside a longer one
 * (anchored-subset case) — this lifts e.g. an embedded clause score
 * without also boosting two long passages that merely share boilerplate
 * vocabulary.
 */
export function containmentWeightedSimilarity(a: string, b: string): number {
    const wordsA = tokenize(a);
    const wordsB = tokenize(b);
    if (wordsA.length === 0 && wordsB.length === 0) return 1;
    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    const counts = new Map<string, number>();
    for (const w of wordsA) counts.set(w, (counts.get(w) ?? 0) + 1);
    let overlap = 0;
    for (const w of wordsB) {
        const c = counts.get(w) ?? 0;
        if (c > 0) {
            overlap++;
            counts.set(w, c - 1);
        }
    }

    const minLen = Math.min(wordsA.length, wordsB.length);
    const containment = overlap / minLen;
    const dice = (2 * overlap) / (wordsA.length + wordsB.length);

    const base = 0.7 * containment + 0.3 * dice;
    const lcsContainment = tokenLcsLength(wordsA, wordsB) / minLen;

    if (minLen >= 8 && minLen <= 70 && containment >= 0.58 && lcsContainment >= 0.42) {
        return Math.max(base, 0.7);
    }

    return base;
}

export function tokenize(s: string): string[] {
    return s.toLowerCase().match(/[a-z0-9$%.,'-]+/g) ?? [];
}

/** Length of the longest common subsequence over two token arrays. */
export function tokenLcsLength(a: string[], b: string[]): number {
    const prev = new Array(b.length + 1).fill(0);
    let last = prev;
    for (let i = 1; i <= a.length; i++) {
        const cur = new Array(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j++) {
            cur[j] =
                a[i - 1] === b[j - 1]
                    ? last[j - 1] + 1
                    : Math.max(last[j], cur[j - 1]);
        }
        last = cur;
    }
    return last[b.length];
}

/**
 * Normalise paragraph text for exact-fingerprint comparison. Strips common
 * markdown emphasis markers (`**`, `_`, backticks, tildes), collapses
 * whitespace, lowercases. Used to detect "same paragraph, moved" cases.
 */
export function fingerprint(s: string): string {
    return s
        .toLowerCase()
        .replace(/[\*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
