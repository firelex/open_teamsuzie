import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import {
    PEOPLE_MIGRATIONS,
    PeopleError,
    PeopleReadError,
    PeopleReader,
    PeopleStore,
    companyDomain,
    prompt,
    sameOrganisation,
    shared,
    tidyName,
    type PersonSource,
    type ReaderEmail,
} from '../index.js';

const OWNER = 'me@scissero.test';
const ME = 'me@scissero.test';
const MAIL: PersonSource = { kind: 'email', account: ME, messageId: 'm1', subject: 'Fees' };

function store() {
    let now = Date.UTC(2026, 9, 27, 9);
    // The clock moves on a millisecond each time it is read, as a real one would.
    return new PeopleStore({ db: openDb({ path: ':memory:', migrations: PEOPLE_MIGRATIONS }), now: () => now++ });
}

function setup() {
    const p = store();
    const answers: string[] = [];
    const prompts: string[] = [];
    const reader = new PeopleReader({
        store: p,
        write: async (text) => {
            prompts.push(text);
            const a = answers.shift();
            if (a === undefined) throw new Error('no answer left');
            return a;
        },
        ownerId: OWNER,
        ownerName: 'Mathias Strasser',
        ownerAddresses: [ME],
        today: () => 'Tuesday 27 October 2026 (2026-10-27)',
        about: () => 'Mathias Strasser is the CEO of Scissero, a law firm.',
    });
    const answer = (parts: Record<string, unknown> = {}) => answers.push(JSON.stringify({ skip: false, people: [], links: [], notes: [], ...parts }));
    const who = (address: string) => p.person(OWNER, p.place(OWNER, { name: null, address })!);
    return { p, reader, answers, prompts, answer, who };
}

const fact = (field: string, text: string, sourceDate: string, source: PersonSource | null = MAIL, evidence = 'x') =>
    ({ field, text, evidence, source, sourceDate }) as Parameters<PeopleStore['addFact']>[2];

const BODY =
    'Dear Mathias,\nThe board approved the term sheet. My colleague Ann Lee (ann@acme.test) will send the drafts.\n\nBest,\nRaj Patel\nChief Financial Officer | Acme Capital';

function email(extra: Partial<ReaderEmail> = {}): ReaderEmail {
    return {
        messageId: 'm1',
        subject: 'Term sheet',
        date: '2026-10-20T09:00:00Z',
        body: BODY,
        people: [
            { name: 'Raj Patel', address: 'raj@acme.test', role: 'from' },
            { name: 'Mathias Strasser', address: ME, role: 'to' },
        ],
        ...extra,
    };
}

describe('prompts', () => {
    it('are the Jeff Desk texts, loaded', () => {
        expect(prompt('people/read_email')).toContain('Is this email substantive?');
        expect(prompt('people/relationships')).toContain('prospective investor');
        expect(prompt('people/summary')).toContain('Write a short description of {name}');
    });
});

describe('placing people', () => {
    it('finds the same person by address, whatever its case', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'Raj@Acme.test' });
        expect(p.place(OWNER, { name: null, address: 'raj@acme.test' })).toBe(a);
        expect(p.person(OWNER, a!).name).toBe('Raj Patel');
    });

    it('keeps each owner apart', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' });
        const b = p.place('other@firm.test', { name: 'Raj Patel', address: 'raj@acme.test' });
        expect(b).not.toBe(a);
        expect(p.listing('other@firm.test').map((x) => x.id)).toEqual([b]);
        expect(() => p.person('other@firm.test', a!)).toThrow(PeopleError);
        expect(p.duplicates(OWNER)).toEqual([]);
    });

    it('tidies names from the address lines', () => {
        const cases: Array<[string, string | null]> = [
            ['Labai, Attila', 'Attila Labai'],
            ['SMITH, John', 'John Smith'],
            ['Beams, Suzanne (LNG-LON)', 'Suzanne Beams'],
            ['Gemma CAMBULAT', 'Gemma Cambulat'],
            ['Lillyman, Ross C - Legal', 'Ross C Lillyman'],
            ['apolinario@huggingface.co', null],
            ['Anne M. Pampinella', 'Anne M. Pampinella'],
            ['Lyman Hawbaker III', 'Lyman Hawbaker III'],
            ['Ivana from Famly', 'Ivana from Famly'],
            ['Mark McDonald', 'Mark McDonald'],
        ];
        for (const [raw, want] of cases) expect(tidyName(raw), raw).toBe(want);
        const p = store();
        expect(p.person(OWNER, p.place(OWNER, { name: 'SMITH, John', address: 'js@acme.test' })!).name).toBe('John Smith');
    });

    it('gives a full name at the same organisation the new address', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        p.addFact(OWNER, a, fact('organisation', 'Acme', '2026-10-01'));
        expect(p.place(OWNER, { name: 'raj  patel', address: 'rpatel@acme-group.test', organisation: 'ACME' })).toBe(a);
        expect(p.person(OWNER, a).addresses).toEqual(['raj@acme.test', 'rpatel@acme-group.test']);
    });

    it('makes the same name elsewhere a new person, flagged as a possible duplicate', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        p.addFact(OWNER, a, fact('organisation', 'Acme', '2026-10-01'));
        const b = p.place(OWNER, { name: 'Raj Patel', address: 'raj@other.test', organisation: 'Other Ltd' });
        expect(b).not.toBe(a);
        const [d] = p.duplicates(OWNER);
        expect(new Set([d!.aId, d!.bId])).toEqual(new Set([a, b]));
        p.dismissDuplicate(OWNER, d!.id);
        expect(p.duplicates(OWNER)).toEqual([]);
    });

    it('reads the company from an email domain but not from a public mail service', () => {
        expect(companyDomain('richard@robinai.co.uk')).toBe('robinai');
        expect(companyDomain('richard@robinai.com')).toBe('robinai');
        expect(companyDomain('john@gmail.com')).toBeNull();
        expect(companyDomain('jane@outlook.com')).toBeNull();
        const p = store();
        const a = p.place(OWNER, { name: 'Richard Robinson', address: 'richard@robinai.co.uk' });
        expect(p.place(OWNER, { name: 'Richard Robinson', address: 'richard@robinai.com' })).toBe(a);
        const b = p.place(OWNER, { name: 'John Smith', address: 'john@gmail.com' });
        expect(p.place(OWNER, { name: 'John Smith', address: 'john.s@gmail.com' })).not.toBe(b); // a public mail domain says nothing
    });

    it('recognises the surname in both mailboxes', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Nidal Homran', address: 'nhomran@scissero.test' });
        expect(p.place(OWNER, { name: 'Nidal Homran', address: 'nhomran@scisserolaw.test' })).toBe(a);
        expect(p.duplicates(OWNER)).toEqual([]);
    });

    it('gives someone first named without an address the address they write from', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Tom Baker', address: null });
        expect(p.place(OWNER, { name: 'Tom Baker', address: 'tom@baker.test' })).toBe(a);
        expect(p.person(OWNER, a!).addresses).toEqual(['tom@baker.test']);
    });

    it('does not place an ambiguous full name, or one at another organisation, without an address', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'John Smith', address: 'john@acme.test' })!;
        p.addFact(OWNER, a, fact('organisation', 'Acme', '2026-10-01'));
        expect(p.place(OWNER, { name: 'John Smith', address: null, organisation: 'Globex Bank' })).toBeNull();
        expect(p.place(OWNER, { name: 'John Smith', address: null, organisation: 'ACME' })).toBe(a);
        p.place(OWNER, { name: 'John Smith', address: 'john@globex.test', organisation: 'Globex' });
        expect(p.place(OWNER, { name: 'John Smith', address: null })).toBeNull();
        expect(p.named(OWNER, 'John Smith')).toHaveLength(2);
    });

    it('refuses an organisation, or a single name without an address', () => {
        const p = store();
        for (const name of ['BEC UK Limited', 'Acme Holdings Ltd', 'Brightline LLP', 'OldCo plc']) {
            expect(() => p.place(OWNER, { name, address: 'info@x.test' }), name).toThrow(PeopleError);
        }
        expect(p.place(OWNER, { name: 'Lyman Hawbaker III', address: 'lh@x.test' })).not.toBeNull();
        expect(() => p.place(OWNER, { name: 'Raj', address: null })).toThrow(PeopleError);
    });

    it('compares organisations by their main word', () => {
        for (const [a, b] of [['Scissero', 'Scissero Law Ltd'], ['Scissero', 'Scissero (Fincap Law)'], ['HaysMac', 'haysmac LLP'], ['iCapital', 'iCapital Network']]) {
            expect(sameOrganisation(a, b), `${a} / ${b}`).toBe(true);
        }
        for (const [a, b] of [['Wallstreetdocs Limited', 'Scissero'], ['Acme', 'Globex'], [null, 'Acme']]) {
            expect(sameOrganisation(a, b), `${a} / ${b}`).toBe(false);
        }
    });
});

describe('facts', () => {
    it('takes the newest fact for a field and keeps the older ones as history', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        p.addFact(OWNER, a, fact('role', 'Finance Director', '2026-01-10'));
        p.addFact(OWNER, a, fact('role', 'CFO', '2026-10-01'));
        p.addFact(OWNER, a, fact('role', 'Controller', '2025-05-01')); // older, read later
        const entry = p.person(OWNER, a);
        expect(entry.role).toBe('CFO');
        expect(entry.facts.filter((f) => f.field === 'role').map((f) => [f.text, f.current]).sort()).toEqual([
            ['CFO', true],
            ['Controller', false],
            ['Finance Director', false],
        ]);
    });

    it('keeps the earliest account of how the contact started', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Clara Ng', address: 'clara@x.test' })!;
        p.addFact(OWNER, a, fact('origin', 'introduced by Tom Baker', '2026-10-21'));
        p.addFact(OWNER, a, fact('origin', 'they approached you', '2026-11-05'));
        expect(p.person(OWNER, a).origin).toBe('introduced by Tom Baker');
    });

    it('does not add the same fact twice, or a note that mostly repeats one', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Liz Furnell', address: 'liz@ah.test' })!;
        expect(p.addFact(OWNER, a, fact('role', 'CFO', '2026-10-01'))).not.toBeNull();
        expect(p.addFact(OWNER, a, fact('role', 'cfo', '2026-10-02'))).toBeNull();
        p.addFact(OWNER, a, fact('note', 'Liz Furnell is a manager at Ashdown Hurrey, handling company accounts.', '2026-09-01'));
        expect(p.addFact(OWNER, a, fact('note', 'Liz Furnell is a manager at Ashdown Hurrey, handling company accounts and tax.', '2026-10-01'))).toBeNull();
        expect(p.addFact(OWNER, a, fact('note', 'Liz Furnell is based in Edinburgh.', '2026-10-02'))).not.toBeNull();
    });

    it('lets the owner’s correction win, and never brings back a deleted fact', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        p.correct(OWNER, a, 'role', 'Chief Executive');
        p.addFact(OWNER, a, fact('role', 'CFO', '2027-01-01'));
        expect(p.person(OWNER, a).role).toBe('Chief Executive');
        const f = p.addFact(OWNER, a, fact('note', 'Raj supports Arsenal.', '2026-10-01'))!;
        p.deleteFact(OWNER, f);
        expect(p.addFact(OWNER, a, fact('note', 'raj supports arsenal', '2026-10-20'))).toBeNull();
    });

    it('refuses unknown relationships and fields, and long notes', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        expect(() => p.addFact(OWNER, a, fact('relationship', 'best mate', '2026-10-01'))).toThrow(PeopleError);
        expect(() => p.addFact(OWNER, a, fact('height', 'tall', '2026-10-01'))).toThrow(PeopleError);
        expect(() => p.addFact(OWNER, a, fact('note', 'x'.repeat(201), '2026-10-01'))).toThrow(PeopleError);
    });

    it('links people once, and refuses unknown kinds', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        const b = p.place(OWNER, { name: 'Ann Lee', address: 'ann@acme.test' })!;
        expect(p.addLink(OWNER, { from: b, kind: 'assistant_to', to: a, evidence: 'my assistant Ann', source: MAIL, sourceDate: '2026-10-01' })).not.toBeNull();
        expect(p.addLink(OWNER, { from: b, kind: 'assistant_to', to: a, evidence: 'my assistant Ann', source: MAIL, sourceDate: '2026-10-02' })).toBeNull();
        expect(p.person(OWNER, a).links.map((l) => [l.kind, l.other, l.direction])).toEqual([['assistant_to', 'Ann Lee', 'in']]);
        expect(() => p.addLink(OWNER, { from: a, kind: 'best_friend', to: b, evidence: 'x', source: MAIL, sourceDate: null })).toThrow(PeopleError);
    });
});

describe('duplicates and merging', () => {
    it('merges a possible duplicate as soon as both are at the same organisation', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Daniel Sandholdt', address: 'marist92@gmail.test' })!;
        p.addFact(OWNER, a, fact('organisation', 'KKR', '2026-01-01'));
        const b = p.place(OWNER, { name: 'Daniel Sandholdt', address: 'daniel.s@kkr.test' })!;
        expect(p.duplicates(OWNER)).toHaveLength(1);
        p.addFact(OWNER, b, fact('organisation', 'KKR & Co.', '2026-02-01'));
        expect(p.duplicates(OWNER)).toEqual([]);
        expect(p.person(OWNER, b).addresses).toEqual(['daniel.s@kkr.test', 'marist92@gmail.test']);
        expect(p.place(OWNER, { name: null, address: 'marist92@gmail.test' })).toBe(b);
    });

    it('moves addresses, facts, links and emails to the person kept, with nothing doubled', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        const b = p.place(OWNER, { name: 'R. Patel', address: 'rp@gmail.test' })!;
        const c = p.place(OWNER, { name: 'Ann Lee', address: 'ann@acme.test' })!;
        for (const x of [a, b]) {
            p.addLink(OWNER, { from: x, kind: 'works_with', to: c, evidence: 'my colleague Ann', source: MAIL, sourceDate: '2026-10-01' });
            p.addFact(OWNER, x, fact('note', 'Raj likes golf.', '2026-10-01'));
        }
        p.addFact(OWNER, b, fact('note', 'Raj has two children.', '2026-10-01'));
        p.exchange(OWNER, b, { account: ME, messageId: 'm1', direction: 'in', date: '2026-10-01T09:00:00Z', subject: 'Hello' });
        p.merge(OWNER, a, b);
        const entry = p.person(OWNER, a);
        expect(entry.addresses).toEqual(['raj@acme.test', 'rp@gmail.test']);
        expect(entry.activity.in).toBe(1);
        expect(entry.links).toHaveLength(1);
        expect(entry.facts.filter((f) => f.field === 'note').map((f) => f.text).sort()).toEqual(['Raj has two children.', 'Raj likes golf.']);
        expect(p.person(OWNER, c).links.map((l) => l.otherId)).toEqual([a]);
        expect(() => p.person(OWNER, b)).toThrow(PeopleError);
        p.ignore(OWNER, a);
        expect(p.place(OWNER, { name: null, address: 'rp@gmail.test' })).toBeNull();
        expect(p.listing(OWNER).map((x) => x.name)).toEqual(['Ann Lee']);
    });

    it('merges the obvious duplicates on request', () => {
        const p = store();
        const a = p.place(OWNER, { name: 'John Smith', address: 'john@acme.test' })!;
        p.addFact(OWNER, a, fact('organisation', 'Acme', '2026-01-01'));
        const b = p.place(OWNER, { name: 'John Smith', address: 'js@globex.test', organisation: 'Globex' })!;
        p.addFact(OWNER, b, fact('organisation', 'Globex', '2026-01-01'));
        expect(p.mergeObvious(OWNER)).toBe(0);
        expect(p.duplicates(OWNER).map((d) => d.aName)).toEqual(['John Smith']);
    });
});

describe('finding people', () => {
    it('by full name, address, or a first name only one frequent correspondent has', () => {
        const p = store();
        const raj = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        p.addFact(OWNER, raj, fact('organisation', 'Acme', '2026-10-01'));
        p.addFact(OWNER, raj, fact('role', 'CFO', '2026-10-01'));
        p.exchange(OWNER, raj, { account: ME, messageId: 'm1', direction: 'in', date: '2026-10-01T09:00:00Z', subject: 'Hello' });
        const ann = p.place(OWNER, { name: 'Ann Lee', address: 'ann@acme.test' })!;
        expect(p.mentioned(OWNER, 'Draft a note to raj patel about fees').map((x) => x.id)).toEqual([raj]);
        expect(p.mentioned(OWNER, 'what did ann@acme.test say?').map((x) => x.id)).toEqual([ann]);
        expect(p.mentioned(OWNER, 'Did Raj reply?').map((x) => x.id)).toEqual([raj]);
        expect(p.mentioned(OWNER, 'did raj reply?')).toEqual([]);
        expect(p.mentioned(OWNER, 'Did Ann reply?')).toEqual([]);
        expect(p.line(p.person(OWNER, raj))).toBe('Raj Patel (raj@acme.test): CFO at Acme; 1 email from them, 0 to them, last 2026-10-01');
        expect(p.listing(OWNER, { organisation: 'acme' }).map((x) => x.name)).toEqual(['Raj Patel']);
        expect(p.find(OWNER, 'patel').map((x) => x.name)).toEqual(['Raj Patel']);
    });
});

describe('PeopleReader.email', () => {
    it('keeps details whose evidence is in the email, with their source', async () => {
        const { reader, answer, who, prompts } = setup();
        answer({
            people: [
                {
                    name: 'Raj Patel',
                    email: 'raj@acme.test',
                    organisation: 'Acme Capital',
                    organisation_evidence: 'Officer | Acme Capital',
                    role: 'Chief Financial Officer',
                    role_evidence: 'Raj Patel\nChief Financial Officer',
                    relationship: null,
                    relationship_evidence: null,
                },
            ],
        });
        const result = await reader.email(email(), false, ME);
        const raj = who('raj@acme.test');
        expect([raj.role, raj.organisation, raj.activity.in, result.outcome]).toEqual(['Chief Financial Officer', 'Acme Capital', 1, 'done']);
        const role = raj.facts.find((f) => f.field === 'role')!;
        expect([role.source?.subject, role.source?.kind, role.sourceDate]).toEqual(['Term sheet', 'email', '2026-10-20T09:00:00Z']);
        expect(prompts[0]).toContain('From: Raj Patel <raj@acme.test>');
        expect(prompts[0]).toContain('Mathias Strasser is the CEO of Scissero, a law firm.');
    });

    it('rejects and counts evidence that is not in the email', async () => {
        const { reader, answer, who } = setup();
        answer({
            people: [{ name: 'Raj Patel', email: 'raj@acme.test', organisation: 'Acme', organisation_evidence: 'Raj Patel, CEO of Acme', role: 'CEO', role_evidence: 'Raj Patel, CEO of Acme' }],
            notes: [{ person: 'raj@acme.test', text: 'Raj likes golf.', evidence: 'I love golf' }],
        });
        expect((await reader.email(email(), false, ME)).rejected).toBe(3);
        expect(who('raj@acme.test').role).toBeNull();
    });

    it('keeps a person named in the body, a link between people, a relationship and a note', async () => {
        const { reader, answer, who } = setup();
        answer({
            people: [
                { name: 'Ann Lee', email: 'ann@acme.test' },
                { name: 'Raj Patel', email: 'raj@acme.test', relationship: 'investor', relationship_evidence: 'The board approved the term sheet' },
            ],
            links: [{ from: 'ann@acme.test', kind: 'works_with', to: 'raj@acme.test', evidence: 'My colleague Ann Lee' }],
            notes: [{ person: 'Raj Patel', text: "Raj Patel's board approved the term sheet.", evidence: 'The board approved the term sheet' }],
        });
        const result = await reader.email(email(), false, ME);
        expect([result.links, result.rejected]).toEqual([1, 0]);
        const ann = who('ann@acme.test');
        expect(ann.links.map((l) => [l.kind, l.other])).toEqual([['works_with', 'Raj Patel']]);
        expect(ann.activity.in).toBe(0);
        const raj = who('raj@acme.test');
        expect(raj.relationship).toBe('investor');
        expect(raj.facts.filter((f) => f.field === 'note').map((f) => f.text)).toEqual(["Raj Patel's board approved the term sheet."]);
    });

    it('rejects a relationship or a link that breaks the rules', async () => {
        const { reader, answer } = setup();
        answer({
            people: [{ name: 'Raj Patel', email: 'raj@acme.test', relationship: 'boss', relationship_evidence: 'The board approved the term sheet' }],
            links: [{ from: 'raj@acme.test', kind: 'mentor_of', to: 'ann@acme.test', evidence: 'My colleague Ann Lee' }],
            notes: [{ person: 'raj@acme.test', text: 'Raj Patel is in London next week.', evidence: 'The board approved the term sheet' }],
        });
        expect((await reader.email(email(), false, ME)).rejected).toBe(3);
    });

    it('skips mail that is not substantive, and an email already read', async () => {
        const { reader, answers, answer, p, prompts } = setup();
        answers.push(JSON.stringify({ skip: true, why: 'a cold sales pitch' }));
        const result = await reader.email(email(), false, ME);
        expect([result.outcome, result.reason]).toEqual(['skipped', 'not substantive: a cold sales pitch']);
        expect(p.listing(OWNER)).toEqual([]);
        answer();
        await reader.email(email({ messageId: 'm2' }), false, ME);
        expect((await reader.email(email({ messageId: 'm2' }), false, ME)).outcome).toBe('skipped');
        expect(prompts).toHaveLength(2);
    });

    it('never makes a person of the owner, a shared mailbox or an automated sender', async () => {
        const { reader, answer, p, prompts } = setup();
        expect(shared('support@famly.test', 'Ivana from Famly')).toBe(true);
        expect(shared('adam.smith@scissero.test', 'Adam Smith')).toBe(false);
        const auto = await reader.email(email({ people: [{ name: 'Bank', address: 'noreply@bank.test', role: 'from' }] }), false, ME);
        expect([auto.outcome, prompts]).toEqual(['skipped', []]);
        answer({ people: [{ name: 'Mathias Strasser', email: ME, organisation: 'Scissero', organisation_evidence: 'Dear Mathias' }] });
        await reader.email(
            email({
                messageId: 'm2',
                people: [
                    { name: 'Raj Patel', address: 'raj@acme.test', role: 'from' },
                    { name: 'Mathias Strasser', address: 'mstrasser@otherfirm.test', role: 'to' },
                    { name: 'Ivana from Famly', address: 'support@famly.test', role: 'cc' },
                ],
            }),
            false,
            ME,
        );
        expect(p.listing(OWNER).map((x) => x.name)).toEqual(['Raj Patel']);
    });

    it('throws on a malformed model answer, keeps nothing, and marks the email failed', async () => {
        const { reader, answers, answer, p } = setup();
        answers.push('Sure! Here are the people.');
        await expect(reader.email(email(), false, ME)).rejects.toThrow(PeopleReadError);
        expect(p.listing(OWNER)).toEqual([]);
        expect(p.processed(OWNER, ME, 'm1')?.outcome).toBe('failed');
        answer({ people: [{ name: 'Raj Patel', email: 'raj@acme.test', role: 'CFO', role_evidence: 'Chief Financial Officer | Acme' }], notes: ['not an object'] });
        await expect(reader.email(email(), false, ME)).rejects.toThrow(/not an object/);
        expect(p.listing(OWNER)).toEqual([]);
        answers.push(JSON.stringify({ skip: false, people: [], links: [] }));
        await expect(reader.email(email(), false, ME)).rejects.toThrow(/"notes" list/);
        answers.push(JSON.stringify({ skip: true }));
        await expect(reader.email(email(), false, ME)).rejects.toThrow(/without saying why/);
        answer();
        expect((await reader.email(email(), false, ME)).outcome).toBe('done'); // a failed email can be read again
    });
});

describe('PeopleReader chat facts and summaries', () => {
    it('keeps a chat fact only for a person the words make clear', () => {
        const { reader, p } = setup();
        const raj = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        const chat: PersonSource = { kind: 'chat', conversation: 'conv-1' };
        expect(reader.chatFact('Raj', 'Raj Patel is moving to Zurich in January.', 'Raj is moving to Zurich', chat)).toBe(raj);
        expect(reader.chatFact('Bob', 'Bob likes tea.', 'Bob likes tea', chat)).toBeNull();
        expect(reader.chatFact('Acme Holdings Ltd', 'Acme Holdings Ltd is a client.', 'Acme Holdings Ltd is a client', chat)).toBeNull();
    });

    it('writes summaries for stale people from their facts and links, and refuses an empty one', async () => {
        const { reader, answers, prompts, p } = setup();
        const raj = p.place(OWNER, { name: 'Raj Patel', address: 'raj@acme.test' })!;
        const ann = p.place(OWNER, { name: 'Ann Lee', address: 'ann@acme.test' })!;
        p.addFact(OWNER, raj, fact('role', 'CFO', '2026-10-01', { kind: 'manual' }));
        p.addLink(OWNER, { from: ann, kind: 'introduced_by', to: raj, evidence: 'introduced by Raj', source: null, sourceDate: '2026-10-01' });
        answers.push('Raj Patel is the CFO of Acme Capital.');
        expect(await reader.summaries([raj])).toBe(1);
        expect(p.person(OWNER, raj).summary).toBe('Raj Patel is the CFO of Acme Capital.');
        expect(prompts[0]).toContain('- role: CFO');
        expect(prompts[0]).toContain('Ann Lee was introduced to Mathias Strasser by Raj Patel.');
        answers.push('  ');
        await expect(reader.summaries()).rejects.toThrow(PeopleReadError);
        expect(p.stale(OWNER)).toEqual([ann]);
    });
});
