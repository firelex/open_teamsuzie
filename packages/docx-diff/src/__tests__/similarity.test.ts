import { describe, expect, it } from 'vitest';
import {
    containmentWeightedSimilarity,
    fingerprint,
    tokenLcsLength,
    tokenize,
} from '../similarity.js';

describe('containmentWeightedSimilarity', () => {
    it('identical strings score 1', () => {
        const s = 'The Borrower shall pay interest at the rate of 5% per annum.';
        expect(containmentWeightedSimilarity(s, s)).toBe(1);
    });

    it('two empty strings score 1 (degenerate equality)', () => {
        expect(containmentWeightedSimilarity('', '')).toBe(1);
    });

    it('one empty side scores 0', () => {
        expect(containmentWeightedSimilarity('', 'something')).toBe(0);
        expect(containmentWeightedSimilarity('something', '')).toBe(0);
    });

    it('totally different texts score low', () => {
        const a = 'The borrower shall pay interest monthly.';
        const b = 'Limitation of liability under this contract.';
        expect(containmentWeightedSimilarity(a, b)).toBeLessThan(0.3);
    });

    it('paraphrases (single threshold/term swap) score high', () => {
        const a = 'The Borrower shall pay interest at the rate of 5% per annum on the outstanding principal.';
        const b = 'The Borrower shall pay interest at the rate of 7% per annum on the outstanding principal.';
        expect(containmentWeightedSimilarity(a, b)).toBeGreaterThan(0.85);
    });

    it('partial subset (short text fully embedded in longer) scores higher than Dice would', () => {
        const short = 'Termination requires thirty days written notice.';
        const long =
            'Either party may terminate this agreement, provided that termination requires thirty days written notice and the terminating party has cured any then-outstanding breach.';
        // Plain Dice on these comes to ~0.43 (overlap ≈ 6 / sum ≈ 28).
        // Containment-weighted lifts it well clear of MIN_REAL_MATCH (0.65).
        expect(containmentWeightedSimilarity(short, long)).toBeGreaterThan(0.65);
    });

    it('anchored short subset gets the LCS boost', () => {
        // 8–70 token range with high containment + LCS containment triggers
        // the floor-at-0.7 boost in containmentWeightedSimilarity.
        const short =
            'The Company shall indemnify and hold harmless the Indemnitee from and against any losses arising from third-party claims.';
        const long =
            'Section 7. Indemnification. The Company shall indemnify and hold harmless the Indemnitee from and against any losses arising from third-party claims, except in cases of gross negligence or willful misconduct as determined by a court of competent jurisdiction.';
        expect(containmentWeightedSimilarity(short, long)).toBeGreaterThanOrEqual(0.7);
    });
});

describe('tokenize', () => {
    it('lowercases and keeps numerics, $, %, periods, commas, apostrophes, hyphens', () => {
        expect(tokenize("It's a 5% rate, $1,000 net-30."))
            .toEqual(["it's", 'a', '5%', 'rate,', '$1,000', 'net-30.']);
    });

    it('returns [] for whitespace-only input', () => {
        expect(tokenize('   \n\t  ')).toEqual([]);
    });
});

describe('tokenLcsLength', () => {
    it('returns the longest common subsequence length over tokens', () => {
        expect(tokenLcsLength(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])).toBe(3);
    });

    it('is zero for disjoint sequences', () => {
        expect(tokenLcsLength(['a', 'b'], ['c', 'd'])).toBe(0);
    });

    it('handles repeats correctly', () => {
        expect(tokenLcsLength(['a', 'b', 'a', 'b'], ['b', 'a', 'b'])).toBe(3);
    });
});

describe('fingerprint', () => {
    it('strips emphasis markers and collapses whitespace', () => {
        expect(fingerprint('  **The**  _Borrower_ shall   `pay` ~interest~. '))
            .toBe('the borrower shall pay interest.');
    });

    it('returns empty string for whitespace-only input', () => {
        expect(fingerprint('   \n\t  ')).toBe('');
    });
});
