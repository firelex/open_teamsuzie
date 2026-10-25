import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '@teamsuzie/webmail-routes';
import { applyPattern, cleanText, emailsIn, normalizeField } from './extract.js';

const spec = (format: FieldSpec['format'], required = true): FieldSpec => ({ from: 'text', format, required });

describe('field values', () => {
    it('cleans every kind of whitespace', () => {
        expect(cleanText(' Fri, Oct 24, 2026, 9:15 AM \n')).toBe('Fri, Oct 24, 2026, 9:15 AM');
    });

    it('applies a pattern by its capture group', () => {
        expect(applyPattern('Account: Me (me@example.com)', '\\(([^)]+)\\)')).toBe('me@example.com');
        expect(applyPattern('nothing here', '\\(([^)]+)\\)')).toBeNull();
        expect(applyPattern(null, '(x)')).toBeNull();
    });

    it('normalises each format', () => {
        expect(normalizeField('Alice <Alice@Example.com>', spec('email'))).toBe('alice@example.com');
        expect(normalizeField('a@x.com and b@y.com', spec('email'))).toBeNull();
        expect(normalizeField('A <a@x.com>; b@y.com', spec('emails'))).toBe('a@x.com, b@y.com');
        expect(normalizeField('no address', spec('emails'))).toBeNull();
        expect(normalizeField('Fri, Oct 24, 2026, 9:15 AM', spec('date'))).not.toBeNull();
        expect(normalizeField('Sat 10/25/2026 1:02 PM', spec('date'))).not.toBeNull();
        expect(normalizeField('yesterday-ish', spec('date'))).toBeNull();
        expect(normalizeField('', spec('nonempty'))).toBeNull();
        expect(normalizeField('18a2b:c-9', spec('id'))).toBe('18a2b:c-9');
        expect(normalizeField('has space', spec('id'))).toBeNull();
        expect(normalizeField('', spec('text'))).toBe('');
        expect(normalizeField('unread', spec('flag'))).toBe('true');
        expect(normalizeField(null, spec('flag'))).toBe('false');
    });

    it('finds email addresses', () => {
        expect(emailsIn('to Me <ME@example.com>, bob@example.org')).toEqual(['me@example.com', 'bob@example.org']);
    });
});
