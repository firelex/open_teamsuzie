import { describe, expect, it } from 'vitest';
import { findPlaceholders, substitute } from './placeholders.js';
import { nextRouteVersion } from './version.js';

describe('placeholders', () => {
    it('finds placeholders, known or not', () => {
        expect(findPlaceholders('to $draft.to about $query and $secret')).toEqual(['$draft.to', '$query', '$secret']);
    });

    it('substitutes with url and css encoding', () => {
        expect(substitute('#search/$query', { $query: 'from:a b' }, 'url')).toBe('#search/from%3Aa%20b');
        expect(substitute('[data-id="$message_id"]', { $message_id: 'a"b\\c' }, 'css')).toBe('[data-id="a\\"b\\\\c"]');
        expect(substitute('$draft.subject', { '$draft.subject': 'Hi' }, 'none')).toBe('Hi');
    });

    it('throws on a placeholder with no value, or an unknown one', () => {
        expect(() => substitute('$query', {}, 'none')).toThrow(/No value for placeholder \$query/);
        expect(() => substitute('$secret', {}, 'none')).toThrow(/Unknown placeholder \$secret/);
    });
});

describe('nextRouteVersion', () => {
    const day = new Date('2026-10-25T12:00:00Z');
    it('starts at .1, increments on the same day and resets on a new day', () => {
        expect(nextRouteVersion(null, day)).toBe('2026-10-25.1');
        expect(nextRouteVersion('2026-10-25.3', day)).toBe('2026-10-25.4');
        expect(nextRouteVersion('2026-10-24.9', day)).toBe('2026-10-25.1');
    });
    it('throws on a malformed previous version', () => {
        expect(() => nextRouteVersion('v2', day)).toThrow(/Not a route version/);
    });
});
