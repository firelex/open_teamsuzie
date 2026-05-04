import {
    containmentWeightedSimilarity,
    fingerprint,
    tokenize,
} from './similarity.js';
import type {
    AlignmentResult,
    ParagraphMatch,
    ParagraphMatchStatus,
} from './types.js';

export interface AlignParagraphsOptions {
    /**
     * Reject paragraph pairs where `min(aTokens, bTokens) / max(aTokens,
     * bTokens) < minLengthRatio`, even if containment-weighted similarity
     * would accept them. Stops the "short LEFT contained in long RIGHT"
     * pattern from producing noisy fine-grained diffs that scatter
     * anchor words through a wholesale paragraph rewrite. Only applies
     * when both paragraphs have at least 8 tokens (so a single defined
     * term still aligns with its expanded definition). Default 0.4.
     */
    minLengthRatio?: number;
}

/**
 * Align two paragraph sequences. Returns one entry per A paragraph plus the
 * set of B indices that nothing in A pointed at.
 *
 * Algorithm:
 *   1. Build a containment-weighted similarity matrix.
 *   2. Run Needleman–Wunsch global alignment over it (substitution score =
 *      sim - MATCH_BIAS so weak similarities lose to gaps; gap cost is
 *      mild so we'd rather skip than force a bad pairing).
 *   3. Rescue/reassignment pass: NW is monotonic so it can leave a strong
 *      alternative pairing on the table when monotonicity would conflict.
 *      Re-pick a better unused B for any A whose current pairing is weak.
 *   4. Length-ratio gate: reject pairings where one side is much longer
 *      than the other, even if containment-weighted similarity passes.
 *   5. Spine pass: keep the longest increasing subsequence of B indices as
 *      the ordered spine; mark off-spine pairs as 'moved' (or strip them
 *      back to unmatched if the pair isn't plausible as a real move).
 *   6. Heckel-style move detection over the still-unmatched residue:
 *      pair by exact fingerprint when unique on both sides, then by
 *      mutual-best fuzzy similarity with a runner-up margin.
 */
export function alignParagraphs(
    a: string[],
    b: string[],
    opts?: AlignParagraphsOptions,
): AlignmentResult {
    const N = a.length;
    const M = b.length;

    const sim: number[][] = a.map((aPara) =>
        b.map((bPara) => containmentWeightedSimilarity(aPara, bPara)),
    );

    const MATCH_BIAS = 0.3;
    const GAP_PENALTY = -0.1;
    const MIN_REAL_MATCH = 0.65;
    const CONFIDENT_THRESHOLD = 0.7;
    /**
     * Minimum tokens on each side before the length-ratio gate kicks in.
     * Below this, a "Borrower" → "the Borrower (the «Borrower»)"
     * style term-expansion still aligns despite the small ratio.
     */
    const MIN_TOKENS_FOR_RATIO_GATE = 8;
    const minLengthRatio = opts?.minLengthRatio ?? 0.4;

    const dp: number[][] = Array.from({ length: N + 1 }, () =>
        new Array(M + 1).fill(0),
    );
    const ptr: number[][] = Array.from({ length: N + 1 }, () =>
        new Array(M + 1).fill(0),
    );

    for (let i = 1; i <= N; i++) {
        dp[i][0] = i * GAP_PENALTY;
        ptr[i][0] = 1;
    }
    for (let j = 1; j <= M; j++) {
        dp[0][j] = j * GAP_PENALTY;
        ptr[0][j] = 2;
    }

    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            const subScore = sim[i - 1][j - 1] - MATCH_BIAS;
            const diag = dp[i - 1][j - 1] + subScore;
            const up = dp[i - 1][j] + GAP_PENALTY;
            const left = dp[i][j - 1] + GAP_PENALTY;
            let best = diag;
            let p = 0;
            if (up > best) {
                best = up;
                p = 1;
            }
            if (left > best) {
                best = left;
                p = 2;
            }
            dp[i][j] = best;
            ptr[i][j] = p;
        }
    }

    const aligned: Array<{ bIdx: number | null }> = new Array(N)
        .fill(null)
        .map(() => ({ bIdx: null }));
    let i = N;
    let j = M;
    while (i > 0 || j > 0) {
        const p = ptr[i][j];
        if (i > 0 && j > 0 && p === 0) {
            const s = sim[i - 1][j - 1];
            aligned[i - 1].bIdx = s >= MATCH_BIAS ? j - 1 : null;
            i--;
            j--;
        } else if (i > 0 && (p === 1 || j === 0)) {
            aligned[i - 1].bIdx = null;
            i--;
        } else {
            j--;
        }
    }

    const RESCUE_MARGIN = 0.1;
    const rebuildMatchedBSet = (exceptAi: number | null = null): Set<number> => {
        const set = new Set<number>();
        aligned.forEach((entry, ai) => {
            if (ai !== exceptAi && entry.bIdx !== null) set.add(entry.bIdx);
        });
        return set;
    };

    for (let ai = 0; ai < N; ai++) {
        const currentBi = aligned[ai].bIdx;
        const currentSim = currentBi !== null ? sim[ai][currentBi] : 0;
        if (currentSim >= CONFIDENT_THRESHOLD) continue;
        const matchedBSet = rebuildMatchedBSet(ai);
        let bestBi = -1;
        let bestSim = Math.max(MIN_REAL_MATCH, currentSim + RESCUE_MARGIN);
        for (let bi = 0; bi < M; bi++) {
            if (matchedBSet.has(bi)) continue;
            if (sim[ai][bi] > bestSim) {
                bestSim = sim[ai][bi];
                bestBi = bi;
            }
        }
        if (bestBi >= 0) {
            aligned[ai].bIdx = bestBi;
        }
    }

    const results: ParagraphMatch[] = [];
    for (let ai = 0; ai < N; ai++) {
        const bi = aligned[ai].bIdx;
        const score = bi !== null ? sim[ai][bi] : 0;
        const acceptedBi = score >= MIN_REAL_MATCH ? bi : null;
        let confident = score >= CONFIDENT_THRESHOLD;
        if (acceptedBi !== null && !confident && score >= MIN_REAL_MATCH) {
            const prev = ai > 0 ? aligned[ai - 1].bIdx : null;
            const next = ai < N - 1 ? aligned[ai + 1].bIdx : null;
            if (prev !== null && prev === acceptedBi - 1) confident = true;
            if (next !== null && next === acceptedBi + 1) confident = true;
        }
        const status: ParagraphMatchStatus =
            acceptedBi !== null ? 'ordered' : 'unmatched';
        results.push({
            aIndex: ai,
            bIndex: acceptedBi,
            aText: a[ai],
            bText: acceptedBi !== null ? b[acceptedBi] : '',
            similarity: acceptedBi !== null ? score : 0,
            confident,
            status,
        });
    }

    markOutOfOrderMatchesAsMoved(results);
    detectMovedParagraphs(a, b, results);

    // Length-ratio gate: containment-weighted matching (NW + move detection)
    // can pair a short paragraph with a much longer one when the short
    // side is mostly contained — similarity is high but the resulting
    // word-LCS diff scatters anchor words across what's effectively a
    // wholesale paragraph rewrite. Apply the gate as a final filter so
    // both NW pairings and Heckel-style move-detection re-pairings get
    // unpaired here. Threshold ignored for very short paragraphs (a
    // single defined term aligned with its expanded definition).
    if (minLengthRatio > 0) {
        for (const m of results) {
            if (m.bIndex === null) continue;
            const aTokens = tokenize(m.aText).length;
            const bTokens = tokenize(m.bText).length;
            if (
                aTokens < MIN_TOKENS_FOR_RATIO_GATE ||
                bTokens < MIN_TOKENS_FOR_RATIO_GATE
            ) {
                continue;
            }
            const ratio =
                Math.min(aTokens, bTokens) / Math.max(aTokens, bTokens);
            if (ratio < minLengthRatio) {
                m.bIndex = null;
                m.bText = '';
                m.similarity = 0;
                m.confident = false;
                m.status = 'unmatched';
            }
        }
    }

    const matchedB = new Set<number>();
    for (const m of results) if (m.bIndex !== null) matchedB.add(m.bIndex);
    const unmatchedB: number[] = [];
    for (let bi = 0; bi < M; bi++) if (!matchedB.has(bi)) unmatchedB.push(bi);

    return { matches: results, unmatchedB };
}

/**
 * The primary NW pass can pair every A paragraph even when those pairings
 * aren't monotonic — it can happen via the rescue pass redirecting a low-
 * confidence pair to a better match that's earlier or later in B than
 * neighboring matches expect. Keep the longest increasing subsequence of B
 * indices as the ordered spine and re-classify the rest.
 */
function markOutOfOrderMatchesAsMoved(matches: ParagraphMatch[]): void {
    const entries = matches
        .map((m, idx) => ({ idx, bIndex: m.bIndex }))
        .filter((e): e is { idx: number; bIndex: number } => e.bIndex !== null);

    if (entries.length <= 1) return;

    const dp = new Array(entries.length).fill(1);
    const prev = new Array(entries.length).fill(-1);

    for (let i = 0; i < entries.length; i++) {
        for (let k = 0; k < i; k++) {
            if (entries[k].bIndex >= entries[i].bIndex) continue;
            const len = dp[k] + 1;
            if (
                len > dp[i] ||
                (len === dp[i] &&
                    prev[i] >= 0 &&
                    entries[k].bIndex < entries[prev[i]].bIndex)
            ) {
                dp[i] = len;
                prev[i] = k;
            }
        }
    }

    let best = 0;
    for (let i = 1; i < entries.length; i++) {
        if (
            dp[i] > dp[best] ||
            (dp[i] === dp[best] && entries[i].bIndex < entries[best].bIndex)
        ) {
            best = i;
        }
    }

    if (dp[best] === entries.length) return;

    const orderedSpine = new Set<number>();
    for (let i = best; i >= 0; i = prev[i]) {
        orderedSpine.add(entries[i].idx);
        if (prev[i] < 0) break;
    }

    for (const entry of entries) {
        if (!orderedSpine.has(entry.idx)) {
            const match = matches[entry.idx];
            if (isPlausibleMovedPair(match)) {
                match.status = 'moved';
                match.confident = true;
            } else {
                match.bIndex = null;
                match.bText = '';
                match.similarity = 0;
                match.confident = false;
                match.status = 'unmatched';
            }
        }
    }
}

function isPlausibleMovedPair(match: ParagraphMatch): boolean {
    if (match.bIndex === null) return false;

    const aFingerprint = fingerprint(match.aText);
    const bFingerprint = fingerprint(match.bText);
    if (aFingerprint && aFingerprint === bFingerprint) {
        return Math.min(tokenize(match.aText).length, tokenize(match.bText).length) >= 4;
    }

    const aTokens = tokenize(match.aText).length;
    const bTokens = tokenize(match.bText).length;
    if (Math.min(aTokens, bTokens) < 8) return false;
    if (match.similarity < 0.78) return false;

    const ratio = Math.min(aTokens, bTokens) / Math.max(aTokens, bTokens);
    return ratio >= 0.35;
}

/**
 * Heckel-style move detection over the residue. NW is monotonic, so a
 * paragraph that survived intact but moved to a different position will
 * fall out as 'unmatched' on both sides. This pass examines unmatched A ×
 * unmatched B ignoring order and pairs them when:
 *
 *   1. Their normalised text is byte-equal AND the fingerprint is unique
 *      on both sides, OR
 *   2. Their fuzzy similarity exceeds a high threshold AND the pair is
 *      mutually best with a clear runner-up margin on both axes.
 *
 * The mutual-best + margin gate keeps repetitive boilerplate from being
 * mis-classified as a move.
 */
function detectMovedParagraphs(
    a: string[],
    b: string[],
    matches: ParagraphMatch[],
): void {
    const FUZZY_THRESHOLD = 0.78;
    const MARGIN = 0.12;
    const MIN_TOKENS_FUZZY = 8;

    const usedB = new Set<number>();
    for (const m of matches) {
        if (m.bIndex !== null) usedB.add(m.bIndex);
    }

    const unmatchedA: number[] = [];
    for (let ai = 0; ai < matches.length; ai++) {
        if (matches[ai].status === 'unmatched') unmatchedA.push(ai);
    }
    const unmatchedB: number[] = [];
    for (let bi = 0; bi < b.length; bi++) {
        if (!usedB.has(bi)) unmatchedB.push(bi);
    }
    if (unmatchedA.length === 0 || unmatchedB.length === 0) return;

    const remA = new Set(unmatchedA);
    const remB = new Set(unmatchedB);

    const fpA = unmatchedA.map((ai) => fingerprint(a[ai]));
    const fpB = unmatchedB.map((bi) => fingerprint(b[bi]));
    const aCount = new Map<string, number>();
    const bCount = new Map<string, number>();
    for (const fp of fpA) if (fp) aCount.set(fp, (aCount.get(fp) ?? 0) + 1);
    for (const fp of fpB) if (fp) bCount.set(fp, (bCount.get(fp) ?? 0) + 1);

    const accept = (ai: number, bi: number, similarity: number) => {
        matches[ai].bIndex = bi;
        matches[ai].bText = b[bi];
        matches[ai].similarity = similarity;
        matches[ai].confident = true;
        matches[ai].status = 'moved';
        remA.delete(ai);
        remB.delete(bi);
    };

    for (let i = 0; i < unmatchedA.length; i++) {
        const ai = unmatchedA[i];
        if (!remA.has(ai)) continue;
        const fp = fpA[i];
        if (!fp) continue;
        if ((aCount.get(fp) ?? 0) !== 1) continue;
        if ((bCount.get(fp) ?? 0) !== 1) continue;
        const j = fpB.findIndex((f, idx) => f === fp && remB.has(unmatchedB[idx]));
        if (j < 0) continue;
        accept(ai, unmatchedB[j], 1);
    }

    const remAArr = [...remA];
    const remBArr = [...remB];
    if (remAArr.length === 0 || remBArr.length === 0) return;

    const tokenLenA = new Map<number, number>();
    const tokensA = (ai: number) => {
        let v = tokenLenA.get(ai);
        if (v === undefined) {
            v = tokenize(a[ai]).length;
            tokenLenA.set(ai, v);
        }
        return v;
    };
    const tokenLenB = new Map<number, number>();
    const tokensB = (bi: number) => {
        let v = tokenLenB.get(bi);
        if (v === undefined) {
            v = tokenize(b[bi]).length;
            tokenLenB.set(bi, v);
        }
        return v;
    };

    const simMat: number[][] = remAArr.map((ai) =>
        remBArr.map((bi) => containmentWeightedSimilarity(a[ai], b[bi])),
    );

    const aliveA = new Array(remAArr.length).fill(true);
    const aliveB = new Array(remBArr.length).fill(true);

    while (true) {
        let chosen: { i: number; j: number; sim: number } | null = null;

        for (let i = 0; i < remAArr.length; i++) {
            if (!aliveA[i]) continue;
            const ai = remAArr[i];
            if (tokensA(ai) < MIN_TOKENS_FUZZY) continue;

            let bestJ = -1;
            let bestSim = -1;
            let secondSim = -1;
            for (let k = 0; k < remBArr.length; k++) {
                if (!aliveB[k]) continue;
                const bi = remBArr[k];
                if (tokensB(bi) < MIN_TOKENS_FUZZY) continue;
                const s = simMat[i][k];
                if (s > bestSim) {
                    secondSim = bestSim;
                    bestSim = s;
                    bestJ = k;
                } else if (s > secondSim) {
                    secondSim = s;
                }
            }
            if (bestJ < 0 || bestSim < FUZZY_THRESHOLD) continue;
            if (bestSim - Math.max(secondSim, 0) < MARGIN) continue;

            let mutBestI = -1;
            let mutBestSim = -1;
            let mutSecondSim = -1;
            for (let k = 0; k < remAArr.length; k++) {
                if (!aliveA[k]) continue;
                const ak = remAArr[k];
                if (tokensA(ak) < MIN_TOKENS_FUZZY) continue;
                const s = simMat[k][bestJ];
                if (s > mutBestSim) {
                    mutSecondSim = mutBestSim;
                    mutBestSim = s;
                    mutBestI = k;
                } else if (s > mutSecondSim) {
                    mutSecondSim = s;
                }
            }
            if (mutBestI !== i) continue;
            if (mutBestSim - Math.max(mutSecondSim, 0) < MARGIN) continue;

            if (!chosen || bestSim > chosen.sim) chosen = { i, j: bestJ, sim: bestSim };
        }

        if (!chosen) break;
        accept(remAArr[chosen.i], remBArr[chosen.j], chosen.sim);
        aliveA[chosen.i] = false;
        aliveB[chosen.j] = false;
    }
}
