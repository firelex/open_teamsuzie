import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { CONFLICTS_MIGRATIONS, PartyRegister, nameSimilarity, normalizeName } from '../index.js';

describe('name matching', () => {
    it('ignores case, accents, punctuation and legal forms', () => {
        expect(normalizeName('The Acme Holdings Ltd.')).toBe('acme');
        expect(normalizeName('Société Générale S.A.')).toBe('societe generale');
        expect(normalizeName('Holdings Ltd')).toBe('holdings ltd');
        expect(nameSimilarity('ACME HOLDINGS LIMITED', 'Acme Ltd')).toBe(1);
        expect(nameSimilarity('Widget & Co', 'Widget and Company')).toBe(1);
    });

    it('scores reordered words and typos high, and different names low', () => {
        expect(nameSimilarity('Smith, John', 'John Smith')).toBeGreaterThanOrEqual(0.9);
        expect(nameSimilarity('Blackrock Capital Partners', 'Blackrok Capital Partners')).toBeGreaterThan(0.9);
        expect(nameSimilarity('Northwind Traders', 'Contoso Pharmaceuticals')).toBeLessThan(0.6);
        expect(nameSimilarity('Apple', 'Applied Materials')).toBeLessThan(0.85);
        expect(nameSimilarity('Acme', 'Acme Widgets')).toBeGreaterThanOrEqual(0.85);
        expect(nameSimilarity('Acmee Widgets', 'Acme Widgets')).toBeGreaterThan(0.9);
    });
});

function setup() {
    const db = openDb({ path: ':memory:', migrations: CONFLICTS_MIGRATIONS });
    return new PartyRegister({ db });
}

const m1 = { type: 'matter', id: 'm1' };
const m2 = { type: 'matter', id: 'm2' };

describe('PartyRegister', () => {
    it('reuses parties with the same normalised name and keeps aliases', () => {
        const reg = setup();
        const a = reg.findOrCreate('Acme Holdings Ltd', 'organisation', 'p');
        expect(reg.findOrCreate('ACME LIMITED', 'organisation', 'p').id).toBe(a.id);
        expect(reg.findOrCreate('Acme', 'person', 'p').id).not.toBe(a.id);
        expect(reg.addAlias(a.id, 'Acme Group').aliases).toEqual(['Acme Group']);
    });

    it('finds parties on other matters, with their roles, and records the decision', () => {
        const reg = setup();
        const widget = reg.findOrCreate('Widget Corp', 'organisation', 'p');
        reg.link(widget.id, m1, 'adverse', 'p');
        const acme = reg.findOrCreate('Acme Ltd', 'organisation', 'p');
        reg.link(acme.id, m1, 'client', 'p');

        const check = reg.check(
            [
                { name: 'Widget Corporation', role: 'client' },
                { name: 'Northwind', role: 'adverse' },
            ],
            'partner@firm.test',
        );
        expect(check.decision).toBe('pending');
        expect(check.hits).toHaveLength(1);
        expect(check.hits[0]).toMatchObject({ query: { name: 'Widget Corporation', role: 'client' }, score: 1 });
        expect(check.hits[0].links.map((l) => [l.subject.id, l.role])).toEqual([['m1', 'adverse']]);

        expect(() => reg.decide(check.id, 'waived', 'p', ' ')).toThrow(/waiver needs a note/);
        expect(reg.decide(check.id, 'declined', 'partner@firm.test', 'Acting against Widget on m1').decision).toBe('declined');
        expect(() => reg.decide(check.id, 'clear', 'p', '')).toThrow(/already decided/);
    });

    it('leaves the checked subject out of its own hits, and attaches early checks', () => {
        const reg = setup();
        const acme = reg.findOrCreate('Acme', 'organisation', 'p');
        reg.link(acme.id, m2, 'client', 'p');
        expect(reg.check([{ name: 'Acme', role: 'client' }], 'p', { subject: m2 }).hits[0].links).toEqual([]);
        const early = reg.check([{ name: 'Acme', role: 'client' }], 'p');
        reg.attachCheck(early.id, m1);
        expect(reg.checksFor(m1).map((c) => c.id)).toEqual([early.id]);
        expect(reg.unlinkSubject(m2)).toBe(1);
        expect(reg.partiesOf(m2)).toEqual([]);
    });
});

describe('party contacts', () => {
    it('recognises a party by address or own domain, never by a free-mail domain', () => {
        const reg = setup();
        const widget = reg.findOrCreate('Widget Corp', 'organisation', 'p');
        const tom = reg.findOrCreate('Tom Private', 'person', 'p');
        expect(reg.addContact(widget.id, '@Widget.com', 'p')).toBe('@widget.com');
        reg.addContact(tom.id, 'tom.private@gmail.com', 'p');
        expect(() => reg.addContact(tom.id, '@gmail.com', 'p')).toThrow(/free-mail/);
        expect(() => reg.addContact(tom.id, 'not an address', 'p')).toThrow(/neither an email address/);
        expect(reg.partiesForAddress('Anna@widget.com').map((p) => p.name)).toEqual(['Widget Corp']);
        expect(reg.partiesForAddress('tom.private@gmail.com').map((p) => p.name)).toEqual(['Tom Private']);
        expect(reg.partiesForAddress('someone@gmail.com')).toEqual([]);
        expect(reg.contactsOf(widget.id)).toEqual(['@widget.com']);
        expect(reg.removeContact(widget.id, '@WIDGET.com')).toBe(true);
        expect(reg.partiesForAddress('anna@widget.com')).toEqual([]);
    });
});
