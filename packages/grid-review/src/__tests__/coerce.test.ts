import { describe, expect, it } from 'vitest';
import { coerceCellOutput } from '../coerce.js';

describe('coerceCellOutput — text', () => {
    it('passes plain prose through trimmed', () => {
        const r = coerceCellOutput('text', '  Some answer with detail.\n');
        expect(r).toEqual({ ok: true, value: 'Some answer with detail.' });
    });

    it('rejects empty input', () => {
        expect(coerceCellOutput('text', '   ').ok).toBe(false);
    });
});

describe('coerceCellOutput — short_text', () => {
    it('collapses whitespace to a single line', () => {
        const r = coerceCellOutput('short_text', '  Delaware\n  ');
        expect(r).toEqual({ ok: true, value: 'Delaware' });
    });

    it('keeps reasonable phrases', () => {
        expect(coerceCellOutput('short_text', 'sixty (60) days').ok).toBe(true);
    });

    it('rejects empty', () => {
        expect(coerceCellOutput('short_text', '').ok).toBe(false);
    });

    it('rejects very long answers', () => {
        const long = 'word '.repeat(60);
        expect(coerceCellOutput('short_text', long).ok).toBe(false);
    });
});

describe('coerceCellOutput — date', () => {
    it('accepts ISO YYYY-MM-DD verbatim', () => {
        expect(coerceCellOutput('date', '2025-01-15')).toEqual({
            ok: true,
            value: '2025-01-15',
        });
    });

    it('parses long-form English dates to ISO', () => {
        expect(coerceCellOutput('date', 'January 15, 2025')).toEqual({
            ok: true,
            value: '2025-01-15',
        });
    });

    it('strips citation markers before parsing', () => {
        expect(coerceCellOutput('date', '2025-01-15 [1]')).toEqual({
            ok: true,
            value: '2025-01-15',
        });
    });

    it('rejects ambiguous slash dates', () => {
        const r = coerceCellOutput('date', '15/01/2025');
        expect(r.ok).toBe(false);
    });

    it('rejects free-form non-dates', () => {
        expect(coerceCellOutput('date', 'sometime next year').ok).toBe(false);
    });
});

describe('coerceCellOutput — yes_no', () => {
    it('accepts plain Yes / No', () => {
        expect(coerceCellOutput('yes_no', 'Yes').value).toBe('Yes');
        expect(coerceCellOutput('yes_no', 'No').value).toBe('No');
    });

    it('accepts trailing prose with citation', () => {
        expect(coerceCellOutput('yes_no', 'Yes — see clause 4 [1].').value).toBe('Yes');
        expect(coerceCellOutput('yes_no', 'no, the contract is silent [1]').value).toBe('No');
    });

    it('canonicalizes synonyms', () => {
        expect(coerceCellOutput('yes_no', 'true').value).toBe('Yes');
        expect(coerceCellOutput('yes_no', 'False').value).toBe('No');
    });

    it('rejects equivocations', () => {
        expect(coerceCellOutput('yes_no', 'Maybe').ok).toBe(false);
        expect(coerceCellOutput('yes_no', 'It depends on the jurisdiction.').ok).toBe(false);
    });
});

describe('coerceCellOutput — bullets', () => {
    it('extracts a markdown bullet list', () => {
        const r = coerceCellOutput('bullets', '- Termination\n- Force majeure\n- Indemnity');
        expect(r).toEqual({
            ok: true,
            value: '- Termination\n- Force majeure\n- Indemnity',
        });
    });

    it('accepts other bullet markers and normalizes', () => {
        const r = coerceCellOutput('bullets', '* one\n+ two\n- three');
        expect(r).toEqual({ ok: true, value: '- one\n- two\n- three' });
    });

    it('ignores prose lines around the bullets', () => {
        const r = coerceCellOutput(
            'bullets',
            'Here are the key clauses:\n- Termination\n- Force majeure\nThose are the main ones.',
        );
        expect(r).toEqual({ ok: true, value: '- Termination\n- Force majeure' });
    });

    it('rejects when no bullets are found', () => {
        expect(coerceCellOutput('bullets', 'Just a single sentence with no list.').ok).toBe(false);
    });
});

describe('coerceCellOutput — money', () => {
    it('accepts symbol-prefix amounts', () => {
        expect(coerceCellOutput('money', '$1,500').value).toBe('$1,500');
        expect(coerceCellOutput('money', '€2,000.50').value).toBe('€2,000.5');
    });

    it('accepts code-prefixed amounts', () => {
        expect(coerceCellOutput('money', 'USD 1500').value).toBe('USD 1,500');
    });

    it('expands k/m/b suffixes', () => {
        expect(coerceCellOutput('money', '$1.5M').value).toBe('$1,500,000');
        expect(coerceCellOutput('money', '€100k').value).toBe('€100,000');
    });

    it('accepts amounts with a trailing currency code', () => {
        expect(coerceCellOutput('money', '500 USD').value).toBe('USD 500');
    });

    it('rejects amounts without a currency', () => {
        expect(coerceCellOutput('money', '1500').ok).toBe(false);
    });

    it('rejects vague answers', () => {
        expect(coerceCellOutput('money', 'a substantial amount').ok).toBe(false);
    });
});
