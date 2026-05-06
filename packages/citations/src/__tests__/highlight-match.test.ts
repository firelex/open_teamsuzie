import { describe, expect, it } from 'vitest';
import { findHighlightRange } from '../highlight-match.js';

describe('findHighlightRange — direct matches', () => {
    it('locates an exact substring', () => {
        const haystack = 'The agreement is governed by Delaware law.';
        const r = findHighlightRange(haystack, 'governed by Delaware');
        expect(r).not.toBeNull();
        expect(r!.start).toBe(haystack.indexOf('governed by Delaware'));
        expect(r!.end).toBe(r!.start + 'governed by Delaware'.length);
        expect(r!.matchedText).toBe('governed by Delaware');
        expect(r!.prefix).toBe(false);
    });

    it('tolerates whitespace drift', () => {
        const haystack = 'The   agreement\tis\ngoverned by Delaware law.';
        const r = findHighlightRange(haystack, 'agreement is governed');
        expect(r).not.toBeNull();
        expect(r!.matchedText).toBe('agreement\tis\ngoverned');
    });

    it('tolerates smart-quote drift in haystack', () => {
        const haystack = 'See the “Agreement” section below.';
        const r = findHighlightRange(haystack, 'the "Agreement" section');
        expect(r).not.toBeNull();
        expect(r!.matchedText).toBe('the “Agreement” section');
    });

    it('tolerates smart-quote drift in needle', () => {
        const haystack = 'See the "Agreement" section below.';
        const r = findHighlightRange(haystack, 'the “Agreement” section');
        expect(r).not.toBeNull();
        expect(r!.matchedText).toBe('the "Agreement" section');
    });

    it('tolerates en/em-dash drift', () => {
        const haystack = 'Term: 2025–2030 — inclusive.';
        const r = findHighlightRange(haystack, '2025-2030 - inclusive');
        expect(r).not.toBeNull();
        expect(r!.matchedText).toBe('2025–2030 — inclusive');
    });

    it('tolerates case drift', () => {
        const haystack = 'Annual Consolidated Revenue from thermal coal mining.';
        const r = findHighlightRange(haystack, 'annual consolidated revenue from THERMAL COAL');
        expect(r).not.toBeNull();
        expect(r!.matchedText).toBe('Annual Consolidated Revenue from thermal coal');
    });

    it('returns null when the needle does not appear', () => {
        const haystack = 'short doc text here.';
        expect(findHighlightRange(haystack, 'totally unrelated phrase')).toBeNull();
    });
});

describe('findHighlightRange — prefix fallback', () => {
    it('uses ellipsis-separated fragments instead of a generic repeated prefix', () => {
        const haystack = [
            'an Investment in a Portfolio Company that derives any of its Annual Consolidated Revenue from unrelated activities. ',
            'an Investment in a Portfolio Company that derives any of its Annual Consolidated Revenues, directly or indirectly, from the manufacture and/or sale of weapons, or weapons related products. ',
            'an Investment in a Portfolio Company that derives any of its Annual Consolidated Revenues from cluster bombs, weapons of mass destruction or biochemical weapons.',
        ].join('');
        const r = findHighlightRange(
            haystack,
            'an Investment in a Portfolio Company that derives any of its Annual Consolidated Revenues... from the manufacture and/or sale of weapons, or weapons related products... an Investment in a Portfolio Company that derives any of its Annual Consolidated Revenues from cluster bombs, weapons of mass destruction or biochemical weapons',
        );
        expect(r).not.toBeNull();
        expect(r!.prefix).toBe(false);
        expect(r!.matchedText).toContain('manufacture and/or sale of weapons');
        expect(r!.matchedText).toContain('cluster bombs');
        expect(r!.matchedText).not.toContain('unrelated activities');
    });

    it('returns null for ellipsis fragments when multiple ordered sequences match', () => {
        const sequence =
            'alpha beta gamma before omitted text delta epsilon zeta after. ';
        const haystack = sequence + sequence;
        const r = findHighlightRange(
            haystack,
            'alpha beta gamma... delta epsilon zeta',
            { allowPrefixMatch: false },
        );
        expect(r).toBeNull();
    });

    it('falls back to the longest matching prefix when full needle is not found', () => {
        const haystack = 'The buyer shall pay the seller within thirty (30) days.';
        // Tail of the needle (about indemnification) is not on this page.
        const r = findHighlightRange(
            haystack,
            'The buyer shall pay the seller within thirty (30) days. Furthermore, the buyer agrees to indemnify the seller.',
        );
        expect(r).not.toBeNull();
        expect(r!.prefix).toBe(true);
        expect(r!.matchedText.startsWith('The buyer shall pay')).toBe(true);
        expect(haystack.includes(r!.matchedText)).toBe(true);
    });

    it('uses a distinctive later anchor instead of a repeated legal lead-in', () => {
        const haystack = [
            'an Investment in a Portfolio Company that (A) is controlled by an Anti-Social Force; ',
            'an Investment in a Portfolio Company that derives 50% or more of its Annual Consolidated Revenue from thermal coal mining or coal mining projects using the mountain top removal method;',
        ].join('');
        const r = findHighlightRange(
            haystack,
            'an Investment in a Portfolio Company that derives 50% or more of its annual consolidated revenue from thermal coal mining or coal mining projects using the mountain top removal method.',
        );
        expect(r).not.toBeNull();
        expect(r!.matchedText).toContain('thermal coal mining');
        expect(r!.matchedText).not.toContain('Anti-Social Force');
    });

    it('refuses prefix match below minPrefixTokens', () => {
        const haystack = 'Foo bar baz.';
        const r = findHighlightRange(
            haystack,
            'Foo bar baz qux quux corge',
            { minPrefixTokens: 4 },
        );
        // Three tokens "Foo bar baz" match but minPrefixTokens=4 forbids it.
        expect(r).toBeNull();
    });

    it('disables prefix fallback when allowPrefixMatch is false', () => {
        const haystack = 'Foo bar baz qux.';
        const r = findHighlightRange(
            haystack,
            'Foo bar baz qux quux',
            { allowPrefixMatch: false },
        );
        expect(r).toBeNull();
    });
});

describe('findHighlightRange — edge cases', () => {
    it('returns null on empty haystack', () => {
        expect(findHighlightRange('', 'anything')).toBeNull();
    });

    it('returns null on empty needle', () => {
        expect(findHighlightRange('some text', '')).toBeNull();
    });

    it('returns null on whitespace-only needle', () => {
        expect(findHighlightRange('some text', '   \n\t')).toBeNull();
    });

    it('handles needles longer than haystack via prefix fallback (with explicit minPrefixTokens)', () => {
        // The default minPrefixTokens is 6 — too high for this contrived
        // 3-token haystack. Drop it explicitly so the prefix-fallback path
        // can fire on tiny inputs like this one.
        const haystack = 'one two three';
        const r = findHighlightRange(
            haystack,
            'one two three four five six seven eight',
            { minPrefixTokens: 3 },
        );
        expect(r).not.toBeNull();
        expect(r!.matchedText).toBe('one two three');
        expect(r!.prefix).toBe(true);
    });

    it('refuses prefix matches that occur multiple times in the haystack', () => {
        // Common phrase ("the General Partner") appears many times in the
        // doc. The model paraphrased the rest of the citation so the full
        // quote isn't verbatim. We should NOT highlight a generic 3-token
        // match — better to return null than to highlight the wrong span.
        const haystack = [
            'The General Partner agrees to act in good faith. ',
            'The General Partner has fiduciary duties. ',
            'The General Partner shall maintain records. ',
            'The General Partner is appointed by the Limited Partners. ',
        ].join('');
        const r = findHighlightRange(
            haystack,
            'The General Partner shall provide written notice... and the Investor will be deemed an Excused Investor',
        );
        expect(r).toBeNull();
    });

    it('returns the longer unique prefix even when shorter ones are ambiguous', () => {
        const haystack = [
            'The General Partner agrees to act. ',
            'The General Partner shall provide written notice within thirty days of any material event affecting the Investor. ',
            'The General Partner is appointed. ',
        ].join('');
        const r = findHighlightRange(
            haystack,
            // Genuine verbatim prefix exists (~14 tokens), then a
            // hallucinated tail. The 14-token prefix matches uniquely.
            'The General Partner shall provide written notice within thirty days of any material event affecting the Investor and shall obtain a release from each Limited Partner before any settlement is finalized',
        );
        expect(r).not.toBeNull();
        expect(r!.matchedText).toContain('within thirty days');
        expect(r!.prefix).toBe(true);
    });
});
