import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

/**
 * The people directory: who the people in the owner's life are, what they
 * do, and how they relate to the owner and to each other. Ported from Jeff
 * Desk (jeff_desk/tools/people.py), with an owner on every row (the person
 * whose mail it came from) so one database can serve many people. Every
 * query is scoped by owner.
 *
 *   people      one row per person: the current name, organisation, role and relationship (worked out from the facts),
 *               a short summary, and whether the owner marked them "not relevant" (status ignored)
 *   addresses   email addresses, each belonging to one person
 *   facts       name / organisation / role / relationship / origin / address / phone values and notes, with evidence and source
 *   links       how two people relate (works_with, reports_to, assistant_to, introduced_by, family_of, other)
 *   exchanges   each email between the owner and a person (in: they wrote to the owner; out: the owner wrote to them)
 *   processed   each email the directory has read, so none is read twice
 *   duplicates  people who may be the same (same full name, different or unknown organisation), for the owner to decide
 *
 * A field's value is the owner's own correction when there is one, otherwise
 * the fact with the newest source date, so a newer email changes a role
 * while the older facts stay as history (how the contact started, "origin",
 * keeps the earliest instead). A fact the owner deleted is never added again.
 */

export const RELATIONSHIPS = [
    'prospect',
    'client',
    'former client',
    'prospective investor',
    'investor',
    'referrer',
    'colleague',
    'adviser',
    'supplier',
    'partner',
    'recruiter',
    'friend',
    'family',
    'other',
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** A person's fields. origin: how the contact started (the earliest account wins); the others: the newest wins. */
export const FIELDS = ['name', 'organisation', 'role', 'relationship', 'origin', 'address', 'phone'] as const;
export type Field = (typeof FIELDS)[number];
export type FactField = Field | 'note';
const EARLIEST: readonly string[] = ['origin'];
/** Characters of a note: one short sentence, not a story. */
export const NOTE_LIMIT = 200;
export const LINKS = ['works_with', 'reports_to', 'assistant_to', 'introduced_by', 'family_of', 'other'] as const;
export type LinkKind = (typeof LINKS)[number];
/** A single first name or surname is recognised only for one of the TOP people the owner exchanges most email with. */
export const TOP = 50;
export const LOOKUP_MATCHES = 10;

/** Where a fact or link was found. */
export interface PersonSource {
    kind: 'email' | 'sent_email' | 'chat' | 'manual' | (string & {});
    account?: string;
    messageId?: string;
    subject?: string | null;
    conversation?: string;
}

export interface Fact {
    id: number;
    field: FactField;
    text: string;
    evidence: string | null;
    source: PersonSource | null;
    sourceDate: string | null;
    origin: 'model' | 'user';
    /** For a field fact, whether it is the field's value now; notes are always current. */
    current: boolean;
}

export interface Link {
    id: number;
    kind: LinkKind;
    /** out: this person is the link's "from"; in: its "to". */
    direction: 'in' | 'out';
    otherId: number;
    other: string | null;
    evidence: string | null;
    source: PersonSource | null;
}

export interface Activity {
    in: number;
    out: number;
    first: string | null;
    last: string | null;
    subjects: Array<string | null>;
    recent: Array<{ subject: string | null; date: string | null; direction: 'in' | 'out'; account: string; messageId: string }>;
}

export interface PersonBrief {
    id: number;
    name: string | null;
    organisation: string | null;
    role: string | null;
    relationship: string | null;
    origin: string | null;
    address: string | null;
    phone: string | null;
    summary: string | null;
    lastContact: string | null;
    addresses: string[];
}

export interface Person extends PersonBrief {
    ownerId: string;
    summaryByUser: boolean;
    status: 'active' | 'ignored';
    firstContact: string | null;
    facts: Fact[];
    links: Link[];
    activity: Activity;
}

export interface Duplicate {
    id: number;
    aId: number;
    aName: string | null;
    bId: number;
    bName: string | null;
    reason: string;
}

export interface Processed {
    account: string;
    messageId: string;
    kind: string;
    at: number;
    outcome: 'done' | 'skipped' | 'failed';
    error: string | null;
}

export const PEOPLE_MIGRATIONS: Migration[] = [
    {
        name: '20261112_create_people',
        up: `
            CREATE TABLE IF NOT EXISTS people (
                id             INTEGER PRIMARY KEY,
                owner_id       TEXT NOT NULL,
                name           TEXT,
                organisation   TEXT,
                role           TEXT,
                relationship   TEXT,
                origin         TEXT,
                address        TEXT,
                phone          TEXT,
                summary        TEXT,
                summary_stale  INTEGER NOT NULL DEFAULT 0,
                summary_by_user INTEGER NOT NULL DEFAULT 0,
                status         TEXT NOT NULL CHECK (status IN ('active', 'ignored')),
                first_contact  TEXT,
                last_contact   TEXT,
                created_at     INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_people_owner ON people(owner_id, status);
            CREATE TABLE IF NOT EXISTS people_addresses (
                owner_id  TEXT NOT NULL,
                address   TEXT NOT NULL,
                person_id INTEGER NOT NULL REFERENCES people(id),
                PRIMARY KEY (owner_id, address)
            );
            CREATE INDEX IF NOT EXISTS idx_people_addresses_person ON people_addresses(person_id);
            CREATE TABLE IF NOT EXISTS people_facts (
                id          INTEGER PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                person_id   INTEGER NOT NULL REFERENCES people(id),
                field       TEXT NOT NULL,
                text        TEXT NOT NULL,
                evidence    TEXT,
                source      TEXT,
                source_date TEXT,
                origin      TEXT NOT NULL CHECK (origin IN ('model', 'user')),
                status      TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
                created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_people_facts_person ON people_facts(person_id);
            CREATE TABLE IF NOT EXISTS people_links (
                id          INTEGER PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                from_id     INTEGER NOT NULL REFERENCES people(id),
                kind        TEXT NOT NULL,
                to_id       INTEGER NOT NULL REFERENCES people(id),
                evidence    TEXT,
                source      TEXT,
                source_date TEXT,
                origin      TEXT NOT NULL CHECK (origin IN ('model', 'user')),
                status      TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
                created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_people_links_owner ON people_links(owner_id);
            CREATE TABLE IF NOT EXISTS people_exchanges (
                owner_id   TEXT NOT NULL,
                person_id  INTEGER NOT NULL REFERENCES people(id),
                account    TEXT NOT NULL,
                message_id TEXT NOT NULL,
                direction  TEXT NOT NULL CHECK (direction IN ('in', 'out')),
                date       TEXT,
                subject    TEXT,
                PRIMARY KEY (person_id, message_id)
            );
            CREATE INDEX IF NOT EXISTS idx_people_exchanges_owner ON people_exchanges(owner_id);
            CREATE TABLE IF NOT EXISTS people_processed (
                owner_id   TEXT NOT NULL,
                account    TEXT NOT NULL,
                message_id TEXT NOT NULL,
                kind       TEXT NOT NULL,
                at         INTEGER NOT NULL,
                outcome    TEXT NOT NULL CHECK (outcome IN ('done', 'skipped', 'failed')),
                error      TEXT,
                PRIMARY KEY (owner_id, account, message_id)
            );
            CREATE TABLE IF NOT EXISTS people_duplicates (
                id       INTEGER PRIMARY KEY,
                owner_id TEXT NOT NULL,
                a_id     INTEGER NOT NULL REFERENCES people(id),
                b_id     INTEGER NOT NULL REFERENCES people(id),
                reason   TEXT NOT NULL,
                status   TEXT NOT NULL CHECK (status IN ('open', 'dismissed', 'merged'))
            );
            CREATE INDEX IF NOT EXISTS idx_people_duplicates_owner ON people_duplicates(owner_id, status);
        `,
    },
];

export class PeopleError extends Error {
    /** not_found: no such person, fact, link or duplicate; invalid_request: anything else the store refuses. */
    constructor(
        message: string,
        readonly code: 'not_found' | 'invalid_request',
    ) {
        super(message);
        this.name = 'PeopleError';
    }
}

// ---- plain-text helpers ----

/** Lower case, with runs of white space made one space. */
export function norm(text: string | null | undefined): string {
    return (text ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

function isUpper(word: string): boolean {
    return word === word.toUpperCase() && word !== word.toLowerCase();
}

function capitalize(word: string): string {
    const chars = [...word];
    return chars.length ? chars[0]!.toUpperCase() + chars.slice(1).join('').toLowerCase() : word;
}

/**
 * A person's name as the address lines give it, made plain: "Labai, Attila"
 * is "Attila Labai", "Beams, Suzanne (LNG-LON)" is "Suzanne Beams", "Gemma
 * CAMBULAT" is "Gemma Cambulat"; an email address is no name (null).
 */
export function tidyName(name: string | null | undefined): string | null {
    if (!name || name.includes('@')) return null;
    let n = name
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+-\s+.*$/, '')
        .replace(/^[ ,]+|[ ,]+$/g, '');
    if (n.split(',').length === 2) {
        const [last, first] = n.split(',').map((x) => x.trim());
        if (last && first) n = `${first} ${last}`;
    }
    const out = words(n).map((w) => (isUpper(w) && [...w].length > 1 && !/^[IVX]+$/.test(w) ? capitalize(w) : w));
    return out.join(' ') || null;
}

const NOTE_STOP = new Set(['the', 'and', 'for', 'with', 'who', 'his', 'her', 'their', 'are', 'was', 'has']);

/** Whether two notes say mostly the same (their words overlap by 60% or more). */
export function similarNote(a: string, b: string): boolean {
    const set = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !NOTE_STOP.has(w)));
    const x = set(a);
    const y = set(b);
    if (!x.size || !y.size) return false;
    const both = [...x].filter((w) => y.has(w)).length;
    const either = new Set([...x, ...y]).size;
    return both / either >= 0.6;
}

/** Text with punctuation and case set aside, to tell whether two facts say the same. */
export function sameText(text: string | null | undefined): string {
    return words((text ?? '').toLowerCase().replace(/[^\p{L}\p{N}_@]+/gu, ' ')).join(' ');
}

/** Words that say what kind of organisation it is, not which: left out when comparing names of organisations. */
const KINDS_OF_ORGANISATION = new Set([
    'ltd', 'limited', 'llp', 'plc', 'inc', 'llc', 'law', 'legal', 'group', 'the', 'co', 'company', 'corp', 'corporation', 'gmbh', 'ag', 'sa',
    'bv', 'network', 'holdings', 'partners', 'and',
]);

/** The legal forms that end the name of an organisation, never a person's ("BEC UK Limited", "Brightline LLP"). */
const LEGAL_FORMS = new Set(['ltd', 'limited', 'llp', 'plc', 'inc', 'llc', 'lp', 'pllc', 'gmbh', 'ag', 'sa', 'sarl', 'bv', 'nv', 'corp', 'corporation', 'spa', 'srl']);

const nameWords = (text: string | null | undefined): string[] => words((text ?? '').toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' '));

/** Whether a name is evidently an organisation's: it ends in a legal form. */
export function organisationName(name: string | null | undefined): boolean {
    const w = nameWords(name);
    return w.length > 0 && LEGAL_FORMS.has(w[w.length - 1]!);
}

function mainWord(organisation: string | null | undefined): string | null {
    return nameWords(organisation).find((w) => !KINDS_OF_ORGANISATION.has(w)) ?? null;
}

/**
 * Whether two names are the same organisation: the same main word
 * ("Scissero", "Scissero Law Ltd" and "Scissero (Fincap Law)" are one).
 */
export function sameOrganisation(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const m = mainWord(a);
    return m !== null && m === mainWord(b);
}

function mailbox(address: string): string {
    return address.split('@')[0]!.toLowerCase();
}

/** Mail services anyone can use: the same one says nothing about who someone works for. */
export const PUBLIC_MAIL = new Set(['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'me', 'mac', 'aol', 'proton', 'protonmail', 'gmx', 'yandex', 'mail']);

/** The company part of an address's domain (robinai for richard@robinai.co.uk), or null for a public mail service. */
export function companyDomain(address: string | null | undefined): string | null {
    let labels = (address ?? '').split('@').pop()!.toLowerCase().split('.').slice(0, -1); // without the last part (.com, .uk, .test)
    if (labels.length > 1 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'ltd', 'plc'].includes(labels[labels.length - 1]!)) labels = labels.slice(0, -1); // robinai.co(.uk)
    const word = labels.length ? labels[labels.length - 1]! : '';
    return word && !PUBLIC_MAIL.has(word) ? word : null;
}

export function fullName(name: string | null | undefined): boolean {
    return words(norm(name)).length >= 2;
}

/**
 * Whether a new address of someone called `name` is evidently theirs too:
 * their surname is in both mailbox names (nhomran@ at two domains,
 * renu.gogna@ and rgogna@), or both are at the same company's domain
 * (robinai.co.uk and robinai.com). A first name alone at different
 * companies (john@), or a public mail service, is not enough.
 */
export function sameMailbox(name: string | null, address: string, addresses: string[]): boolean {
    const surname = name && fullName(name) ? words(norm(name)).pop()! : '';
    if (surname.length >= 3 && mailbox(address).includes(surname) && addresses.some((a) => mailbox(a).includes(surname))) return true;
    const company = companyDomain(address);
    return !!company && addresses.some((a) => companyDomain(a) === company);
}

// ---- the store ----

interface FactRow {
    id: number;
    text: string;
    origin: 'model' | 'user';
    source_date: string | null;
    created_at: number;
}

interface PeopleRow {
    id: number;
    owner_id: string;
    name: string | null;
    organisation: string | null;
    role: string | null;
    relationship: string | null;
    origin: string | null;
    address: string | null;
    phone: string | null;
    summary: string | null;
    summary_by_user: number;
    status: 'active' | 'ignored';
    first_contact: string | null;
    last_contact: string | null;
}

export interface AddFact {
    field: FactField;
    text: string;
    evidence: string | null;
    source: PersonSource | null;
    sourceDate: string | null;
    /** model: read from a source; user: the owner's own value, which wins. */
    origin?: 'model' | 'user';
}

export interface AddLink {
    from: number;
    kind: string;
    to: number;
    evidence: string | null;
    source: PersonSource | null;
    sourceDate: string | null;
    origin?: 'model' | 'user';
}

export interface PlacePerson {
    name: string | null;
    address: string | null;
    organisation?: string | null;
    source?: PersonSource | null;
    sourceDate?: string | null;
}

const sourceText = (source: PersonSource | null | undefined): string | null => (source == null ? null : JSON.stringify(source));
const sourceValue = (text: string | null): PersonSource | null => (text === null ? null : (JSON.parse(text) as PersonSource));

export class PeopleStore {
    private readonly db: DatabaseInstance;
    private readonly clock: () => number;

    constructor(opts: { db: DatabaseInstance; now?: () => number }) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => Date.now());
    }

    /** Today's date (UTC) as YYYY-MM-DD. */
    today(): string {
        return new Date(this.clock()).toISOString().slice(0, 10);
    }

    // ---- placing people ----

    /**
     * The person with this address, or with this full name; made when there
     * is none. Null for a person the owner marked not relevant, and for a
     * full name without an address that does not say which person it is
     * (several people have it, or the one who has it is at another
     * organisation): never placed on a guess. Throws when there is neither an
     * address nor a full name, or the name is an organisation's. The look-up
     * and the making are one transaction.
     */
    place(ownerId: string, input: PlacePerson): number | null {
        const address = input.address && input.address.trim() ? input.address.trim().toLowerCase() : null;
        const name = tidyName(input.name);
        const organisation = input.organisation ?? null;
        if (!address && !(name && fullName(name))) throw new PeopleError(`a person needs an email address or a full name, not ${JSON.stringify(name)}`, 'invalid_request');
        if (organisationName(name)) throw new PeopleError(`${JSON.stringify(name)} is the name of an organisation, not of a person`, 'invalid_request');
        const at = (p: { organisation: string | null }) => sameOrganisation(organisation, p.organisation);
        const addAddress = (personId: number) => prepareCached(this.db, `INSERT INTO people_addresses (owner_id, address, person_id) VALUES (?, ?, ?)`).run(ownerId, address, personId);
        const placed = this.db.transaction((): { id: number | null; made: boolean } => {
            if (address) {
                const row = prepareCached<[string, string], { id: number; status: string }>(
                    this.db,
                    `SELECT p.id, p.status FROM people_addresses a JOIN people p ON p.id = a.person_id WHERE a.owner_id = ? AND a.address = ?`,
                ).get(ownerId, address);
                if (row) return { id: row.status === 'ignored' ? null : row.id, made: false };
            }
            const same = name && fullName(name) ? this.named(ownerId, name) : [];
            const ours = same.filter(at);
            if (!address) {
                const ignored = prepareCached<[string], { name: string }>(this.db, `SELECT name FROM people WHERE owner_id = ? AND status = 'ignored' AND name IS NOT NULL`).all(ownerId);
                if (name && ignored.some((r) => norm(r.name) === norm(name))) return { id: null, made: false };
                if (ours.length === 1) return { id: ours[0]!.id, made: false };
                if (same.length === 1 && !(organisation && same[0]!.organisation && !at(same[0]!))) return { id: same[0]!.id, made: false };
                if (same.length) return { id: null, made: false };
            } else {
                // The same name and an address that is evidently theirs too (the same mailbox name, or their surname in both).
                const theirs = same.filter((p) => sameMailbox(name, address, this.addresses(ownerId, p.id)));
                if (theirs.length === 1) {
                    addAddress(theirs[0]!.id);
                    return { id: theirs[0]!.id, made: false };
                }
                // Someone of that name known so far only from being named (no address of their own) is the same person,
                // unless their organisation says otherwise.
                const bare = same.filter((p) => this.addresses(ownerId, p.id).length === 0 && !(organisation && p.organisation && !at(p)));
                const found = ours.length === 1 ? ours : same.length === 1 && bare.length === 1 ? bare : [];
                if (found.length) {
                    addAddress(found[0]!.id);
                    return { id: found[0]!.id, made: false };
                }
            }
            const now = this.clock();
            const made = Number(
                prepareCached(this.db, `INSERT INTO people (owner_id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)`).run(ownerId, now, now).lastInsertRowid,
            );
            if (address) addAddress(made);
            for (const p of same) {
                prepareCached(this.db, `INSERT INTO people_duplicates (owner_id, a_id, b_id, reason, status) VALUES (?, ?, ?, ?, 'open')`).run(
                    ownerId,
                    p.id,
                    made,
                    `Both are called ${name}; their organisations differ or are not known.`,
                );
            }
            return { id: made, made: true };
        })();
        if (placed.made && name) this.addFact(ownerId, placed.id!, { field: 'name', text: name, evidence: name, source: input.source ?? null, sourceDate: input.sourceDate ?? null });
        return placed.id;
    }

    /** Active people whose name is this full name (case and spaces ignored). */
    named(ownerId: string, name: string): Array<{ id: number; name: string; organisation: string | null }> {
        return prepareCached<[string], { id: number; name: string; organisation: string | null }>(
            this.db,
            `SELECT id, name, organisation FROM people WHERE owner_id = ? AND status = 'active' AND name IS NOT NULL ORDER BY id`,
        )
            .all(ownerId)
            .filter((r) => norm(r.name) === norm(name));
    }

    /**
     * An email address of this person's, as the owner told it. Throws when it
     * is not an email address, or is already someone else's (the owner can
     * merge the two people if they are one).
     */
    giveAddress(ownerId: string, personId: number, address: string): void {
        const a = address.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) throw new PeopleError(`${JSON.stringify(a)} is not an email address`, 'invalid_request');
        this.personRow(ownerId, personId);
        const row = prepareCached<[string, string], { person_id: number }>(this.db, `SELECT person_id FROM people_addresses WHERE owner_id = ? AND address = ?`).get(ownerId, a);
        if (row && row.person_id !== personId) {
            throw new PeopleError(`${a} already belongs to someone else in the people directory (person ${row.person_id}); merge them if they are the same person`, 'invalid_request');
        }
        prepareCached(this.db, `INSERT OR IGNORE INTO people_addresses (owner_id, address, person_id) VALUES (?, ?, ?)`).run(ownerId, a, personId);
    }

    // ---- facts and links ----

    /**
     * A fact about a person; its id, or null when the same text is already
     * known (or was deleted by the owner) for that person and field. A later
     * email saying a known value again makes it current again.
     */
    addFact(ownerId: string, personId: number, fact: AddFact): number | null {
        const { field } = fact;
        const origin = fact.origin ?? 'model';
        if (!(FIELDS as readonly string[]).includes(field) && field !== 'note') throw new PeopleError(`a fact is about ${[...FIELDS, 'note'].join(', ')}, not ${JSON.stringify(field)}`, 'invalid_request');
        let text = words(fact.text ?? '').join(' ');
        if (!text) throw new PeopleError('a fact needs a text', 'invalid_request');
        if (field === 'note' && [...text].length > NOTE_LIMIT) throw new PeopleError(`a note is one short sentence (at most ${NOTE_LIMIT} characters), not ${[...text].length}`, 'invalid_request');
        if (field === 'relationship') {
            text = text.toLowerCase();
            if (!(RELATIONSHIPS as readonly string[]).includes(text)) throw new PeopleError(`a relationship is one of ${RELATIONSHIPS.join(', ')}, not ${JSON.stringify(text)}`, 'invalid_request');
        }
        if (this.personRow(ownerId, personId).status === 'ignored') throw new PeopleError(`person ${personId} is marked not relevant: nothing more is learned about them`, 'invalid_request');
        // A fact from email is new unless the same text is known (or was deleted by the owner); the owner's own value is
        // new unless the owner already gave it.
        const result = this.db.transaction((): { made: number | null; changed: boolean } | null => {
            const known = prepareCached<[number, string], { id: number; text: string; status: string; source_date: string | null; origin: string }>(
                this.db,
                `SELECT id, text, status, source_date, origin FROM people_facts WHERE person_id = ? AND field = ?` +
                    (origin === 'user' ? ` AND origin = 'user' AND status = 'active'` : '') +
                    ` ORDER BY id`,
            ).all(personId, field);
            const again = known.find((k) => sameText(k.text) === sameText(text) || (field === 'note' && k.status === 'active' && similarNote(k.text, text)));
            if (again) {
                // Known already: a later email saying it again makes it current again (its date is the latest it was seen);
                // a fact the owner deleted stays deleted.
                if (origin === 'model' && again.origin === 'model' && again.status === 'active' && fact.sourceDate && fact.sourceDate > (again.source_date ?? '') && !EARLIEST.includes(field)) {
                    prepareCached(this.db, `UPDATE people_facts SET source = ?, source_date = ?, evidence = ? WHERE id = ?`).run(sourceText(fact.source), fact.sourceDate, fact.evidence, again.id);
                    return { made: null, changed: true };
                }
                return null;
            }
            const made = prepareCached(
                this.db,
                `INSERT INTO people_facts (owner_id, person_id, field, text, evidence, source, source_date, origin, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
            ).run(ownerId, personId, field, text, fact.evidence, sourceText(fact.source), fact.sourceDate, origin, this.clock()).lastInsertRowid;
            return { made: Number(made), changed: false };
        })();
        if (result === null) return null;
        this.refresh(personId);
        if (field === 'organisation') this.mergeSameOrganisation(ownerId, personId);
        return result.made;
    }

    /** How one person relates to another; its id, or null when it is already known (or was deleted). */
    addLink(ownerId: string, link: AddLink): number | null {
        if (!(LINKS as readonly string[]).includes(link.kind)) throw new PeopleError(`a link is one of ${LINKS.join(', ')}, not ${JSON.stringify(link.kind)}`, 'invalid_request');
        if (link.from === link.to) throw new PeopleError('a person is not linked to themselves', 'invalid_request');
        this.personRow(ownerId, link.from);
        this.personRow(ownerId, link.to);
        return this.db.transaction((): number | null => {
            if (prepareCached(this.db, `SELECT 1 FROM people_links WHERE from_id = ? AND kind = ? AND to_id = ?`).get(link.from, link.kind, link.to)) return null;
            const now = this.clock();
            const made = Number(
                prepareCached(
                    this.db,
                    `INSERT INTO people_links (owner_id, from_id, kind, to_id, evidence, source, source_date, origin, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
                ).run(ownerId, link.from, link.kind, link.to, link.evidence, sourceText(link.source), link.sourceDate, link.origin ?? 'model', now).lastInsertRowid,
            );
            for (const p of [link.from, link.to]) {
                prepareCached(this.db, `UPDATE people SET summary_stale = 1 - summary_by_user, updated_at = ? WHERE id = ?`).run(now, p);
            }
            return made;
        })();
    }

    /** The fact each field's value comes from: the newest owner correction, else the model fact with the newest source date. */
    private current(personId: number): Map<Field, FactRow> {
        const out = new Map<Field, FactRow>();
        const all = prepareCached<[number], FactRow & { field: string }>(
            this.db,
            `SELECT id, field, text, origin, source_date, created_at FROM people_facts WHERE person_id = ? AND status = 'active' ORDER BY id`,
        ).all(personId);
        // Ties are broken by the later row, so the order is the same whatever the clock's resolution.
        const later = (a: FactRow, b: FactRow, key: (r: FactRow) => [string | number, number]) => {
            const [ka, ca] = key(a);
            const [kb, cb] = key(b);
            return ka !== kb ? ka > kb : ca !== cb ? ca > cb : a.id > b.id;
        };
        for (const field of FIELDS) {
            const rows = all.filter((r) => r.field === field);
            const users = rows.filter((r) => r.origin === 'user');
            let chosen: FactRow | undefined;
            if (users.length) chosen = users.reduce((best, r) => (later(r, best, (x) => [x.created_at, 0]) ? r : best));
            else if (rows.length && EARLIEST.includes(field)) chosen = rows.reduce((best, r) => (later(best, r, (x) => [x.source_date ?? '9999', x.created_at]) ? r : best));
            else if (rows.length) chosen = rows.reduce((best, r) => (later(r, best, (x) => [x.source_date ?? '', x.created_at]) ? r : best));
            if (chosen) out.set(field, chosen);
        }
        return out;
    }

    /** Work out the person's fields again from their facts, and mark the summary as needing a rewrite. */
    private refresh(personId: number): void {
        const chosen = this.current(personId);
        prepareCached(
            this.db,
            `UPDATE people SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, summary_stale = 1 - summary_by_user, updated_at = ? WHERE id = ?`,
        ).run(...FIELDS.map((f) => chosen.get(f)?.text ?? null), this.clock(), personId);
    }

    /** An email between the owner and this person (counted once). */
    exchange(ownerId: string, personId: number, e: { account: string; messageId: string; direction: 'in' | 'out'; date: string | null; subject: string | null }): void {
        if (e.direction !== 'in' && e.direction !== 'out') throw new PeopleError(`an exchange is in or out, not ${JSON.stringify(e.direction)}`, 'invalid_request');
        this.personRow(ownerId, personId);
        this.db.transaction(() => {
            prepareCached(
                this.db,
                `INSERT OR IGNORE INTO people_exchanges (owner_id, person_id, account, message_id, direction, date, subject) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(ownerId, personId, e.account, e.messageId, e.direction, e.date, e.subject);
            this.contacts(personId);
        })();
    }

    private contacts(personId: number): void {
        const r = prepareCached<[number], { first: string | null; last: string | null }>(
            this.db,
            `SELECT MIN(date) AS first, MAX(date) AS last FROM people_exchanges WHERE person_id = ?`,
        ).get(personId)!;
        prepareCached(this.db, `UPDATE people SET first_contact = ?, last_contact = ? WHERE id = ?`).run(r.first, r.last, personId);
    }

    // ---- emails read ----

    processed(ownerId: string, account: string, messageId: string): Processed | null {
        const r = prepareCached<[string, string, string], { account: string; message_id: string; kind: string; at: number; outcome: Processed['outcome']; error: string | null }>(
            this.db,
            `SELECT account, message_id, kind, at, outcome, error FROM people_processed WHERE owner_id = ? AND account = ? AND message_id = ?`,
        ).get(ownerId, account, messageId);
        return r ? { account: r.account, messageId: r.message_id, kind: r.kind, at: r.at, outcome: r.outcome, error: r.error } : null;
    }

    /** Record an email as done, skipped (error: why) or failed (error: what went wrong, so it can be read again). */
    mark(ownerId: string, account: string, messageId: string, kind: string, outcome: Processed['outcome'], error: string | null = null): void {
        prepareCached(
            this.db,
            `INSERT INTO people_processed (owner_id, account, message_id, kind, at, outcome, error) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_id, account, message_id) DO UPDATE SET kind = excluded.kind, at = excluded.at, outcome = excluded.outcome, error = excluded.error`,
        ).run(ownerId, account, messageId, kind, this.clock(), outcome, error);
    }

    /** The emails whose reading failed, oldest first. */
    failed(ownerId: string): Processed[] {
        return prepareCached<[string], { account: string; message_id: string; kind: string; at: number; outcome: Processed['outcome']; error: string | null }>(
            this.db,
            `SELECT account, message_id, kind, at, outcome, error FROM people_processed WHERE owner_id = ? AND outcome = 'failed' ORDER BY at`,
        )
            .all(ownerId)
            .map((r) => ({ account: r.account, messageId: r.message_id, kind: r.kind, at: r.at, outcome: r.outcome, error: r.error }));
    }

    // ---- the owner's control ----

    /**
     * The one person the owner means: by email address or exact full name;
     * someone new when given an address or a full name nobody has. Throws
     * when it is not clear who.
     */
    told(ownerId: string, person: string): number {
        const p = person.trim();
        const found = p.includes('@') ? this.find(ownerId, p).map((x) => x.id) : this.named(ownerId, p).map((x) => x.id);
        if (found.length === 1) return found[0]!;
        if (found.length) throw new PeopleError(`Several people are called ${p}; give their email address`, 'invalid_request');
        if (p.includes('@') || fullName(p)) {
            const id = this.place(ownerId, { name: p.includes('@') ? null : p, address: p.includes('@') ? p : null });
            if (id === null) throw new PeopleError(`${p} is marked not relevant, or it is not clear who that is; give their email address`, 'invalid_request');
            return id;
        }
        throw new PeopleError(`Nobody in the people directory is ${JSON.stringify(p)}; give their full name or email address`, 'not_found');
    }

    /**
     * The owner's own value for a field (or a note): it wins over every fact
     * from email, now and later. source: where the owner said it (a chat), or
     * manual (a form) when not given.
     */
    correct(ownerId: string, personId: number, field: FactField, text: string, source: PersonSource = { kind: 'manual' }): number | null {
        const made = this.addFact(ownerId, personId, { field, text, evidence: null, source, sourceDate: this.today(), origin: 'user' });
        if (made === null && field !== 'note') {
            // The same value again: it is made the owner's choice once more.
            const same = words(text).join(' ');
            for (const r of prepareCached<[number, string], { id: number; text: string }>(
                this.db,
                `SELECT id, text FROM people_facts WHERE person_id = ? AND field = ? AND origin = 'user' AND status = 'active'`,
            ).all(personId, field)) {
                if (sameText(r.text) === sameText(same)) prepareCached(this.db, `UPDATE people_facts SET created_at = ? WHERE id = ?`).run(this.clock(), r.id);
            }
            this.refresh(personId);
        }
        return made;
    }

    deleteFact(ownerId: string, factId: number): void {
        const row = prepareCached<[number, string], { person_id: number }>(this.db, `SELECT person_id FROM people_facts WHERE id = ? AND owner_id = ? AND status = 'active'`).get(factId, ownerId);
        if (!row) throw new PeopleError(`No fact ${factId}`, 'not_found');
        prepareCached(this.db, `UPDATE people_facts SET status = 'deleted' WHERE id = ?`).run(factId);
        this.refresh(row.person_id);
    }

    deleteLink(ownerId: string, linkId: number): void {
        const done = prepareCached(this.db, `UPDATE people_links SET status = 'deleted' WHERE id = ? AND owner_id = ? AND status = 'active'`).run(linkId, ownerId);
        if (done.changes !== 1) throw new PeopleError(`No link ${linkId}`, 'not_found');
    }

    setSummary(ownerId: string, personId: number, text: string, byUser: boolean): void {
        this.personRow(ownerId, personId);
        prepareCached(this.db, `UPDATE people SET summary = ?, summary_by_user = ?, summary_stale = 0, updated_at = ? WHERE id = ?`).run(text.trim(), byUser ? 1 : 0, this.clock(), personId);
    }

    /** The owner's own summary is removed: one is written again from the facts. */
    clearUserSummary(ownerId: string, personId: number): void {
        this.personRow(ownerId, personId);
        prepareCached(this.db, `UPDATE people SET summary = NULL, summary_by_user = 0, summary_stale = 1, updated_at = ? WHERE id = ?`).run(this.clock(), personId);
    }

    /**
     * Not relevant: everything known about the person is erased; their
     * addresses and name stay, so later email from or about them is
     * recognised and nothing more is learned.
     */
    ignore(ownerId: string, personId: number): void {
        this.personRow(ownerId, personId);
        this.db.transaction(() => {
            prepareCached(this.db, `DELETE FROM people_facts WHERE person_id = ?`).run(personId);
            prepareCached(this.db, `DELETE FROM people_links WHERE from_id = ? OR to_id = ?`).run(personId, personId);
            prepareCached(this.db, `DELETE FROM people_exchanges WHERE person_id = ?`).run(personId);
            prepareCached(this.db, `UPDATE people_duplicates SET status = 'dismissed' WHERE status = 'open' AND (a_id = ? OR b_id = ?)`).run(personId, personId);
            prepareCached(
                this.db,
                `UPDATE people SET status = 'ignored', organisation = NULL, role = NULL, relationship = NULL, origin = NULL, address = NULL, phone = NULL,
                 summary = NULL, summary_stale = 0, summary_by_user = 0, first_contact = NULL, last_contact = NULL, updated_at = ? WHERE id = ?`,
            ).run(this.clock(), personId);
        })();
    }

    /** Two entries are the same person: everything of goneId (addresses, facts, links, emails) moves to keepId, and goneId is removed. */
    merge(ownerId: string, keepId: number, goneId: number): void {
        if (keepId === goneId) throw new PeopleError('a person cannot be merged with themselves', 'invalid_request');
        this.personRow(ownerId, keepId);
        this.personRow(ownerId, goneId);
        const run = (sql: string, ...params: unknown[]) => prepareCached(this.db, sql).run(...params);
        this.db.transaction(() => {
            run(`UPDATE people_addresses SET person_id = ? WHERE person_id = ?`, keepId, goneId);
            run(`UPDATE people_facts SET person_id = ? WHERE person_id = ?`, keepId, goneId);
            run(`UPDATE people_links SET from_id = ? WHERE from_id = ?`, keepId, goneId);
            run(`UPDATE people_links SET to_id = ? WHERE to_id = ?`, keepId, goneId);
            run(`DELETE FROM people_links WHERE owner_id = ? AND from_id = to_id`, ownerId);
            run(`UPDATE OR IGNORE people_exchanges SET person_id = ? WHERE person_id = ?`, keepId, goneId);
            run(`DELETE FROM people_exchanges WHERE person_id = ?`, goneId);
            run(`UPDATE people_duplicates SET status = 'merged' WHERE status = 'open' AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))`, keepId, goneId, goneId, keepId);
            run(`UPDATE people_duplicates SET a_id = ? WHERE a_id = ?`, keepId, goneId);
            run(`UPDATE people_duplicates SET b_id = ? WHERE b_id = ?`, keepId, goneId);
            run(`DELETE FROM people WHERE id = ?`, goneId);
            // What both entries knew is kept once.
            run(
                `DELETE FROM people_links WHERE owner_id = ? AND status = 'active'
                   AND id NOT IN (SELECT MIN(id) FROM people_links WHERE owner_id = ? AND status = 'active' GROUP BY from_id, kind, to_id)`,
                ownerId,
                ownerId,
            );
            const seen = new Set<string>();
            for (const f of prepareCached<[number], { id: number; field: string; text: string; origin: string; status: string }>(
                this.db,
                `SELECT id, field, text, origin, status FROM people_facts WHERE person_id = ? ORDER BY id`,
            ).all(keepId)) {
                const key = JSON.stringify([f.field, sameText(f.text), f.origin, f.status]);
                if (seen.has(key)) run(`DELETE FROM people_facts WHERE id = ?`, f.id);
                seen.add(key);
            }
            run(`DELETE FROM people_duplicates WHERE owner_id = ? AND a_id = b_id`, ownerId);
            run(
                `DELETE FROM people_duplicates WHERE owner_id = ? AND status = 'open'
                   AND id NOT IN (SELECT MIN(id) FROM people_duplicates WHERE owner_id = ? AND status = 'open' GROUP BY MIN(a_id, b_id), MAX(a_id, b_id))`,
                ownerId,
                ownerId,
            );
            this.contacts(keepId);
            this.refresh(keepId);
        })();
    }

    /** A possible duplicate of this person that turns out to be at the same organisation is the same person: merged into this one. */
    private mergeSameOrganisation(ownerId: string, personId: number): void {
        const mine = prepareCached<[number], { organisation: string | null }>(this.db, `SELECT organisation FROM people WHERE id = ?`).get(personId);
        const pairs = prepareCached<[string, number, number], { a_id: number; b_id: number }>(
            this.db,
            `SELECT a_id, b_id FROM people_duplicates WHERE owner_id = ? AND status = 'open' AND (a_id = ? OR b_id = ?)`,
        ).all(ownerId, personId, personId);
        for (const { a_id, b_id } of pairs) {
            const other = a_id === personId ? b_id : a_id;
            const row = prepareCached<[number], { organisation: string | null }>(this.db, `SELECT organisation FROM people WHERE id = ? AND status = 'active'`).get(other);
            if (mine && row && sameOrganisation(mine.organisation, row.organisation)) this.merge(ownerId, personId, other);
        }
    }

    /** The possible duplicates that are evidently one person (the same organisation, or an address evidently theirs too) merged; how many. */
    mergeObvious(ownerId: string): number {
        let count = 0;
        // A merge points the other pairs of the person merged away at the one kept: look again after each.
        for (;;) {
            const pair = this.duplicates(ownerId).find((d) => {
                const a = this.person(ownerId, d.aId);
                const b = this.person(ownerId, d.bId);
                return sameOrganisation(a.organisation, b.organisation) || a.addresses.some((x) => sameMailbox(a.name ?? b.name, x, b.addresses));
            });
            if (!pair) return count;
            this.merge(ownerId, pair.aId, pair.bId);
            count++;
        }
    }

    dismissDuplicate(ownerId: string, duplicateId: number): void {
        const done = prepareCached(this.db, `UPDATE people_duplicates SET status = 'dismissed' WHERE id = ? AND owner_id = ? AND status = 'open'`).run(duplicateId, ownerId);
        if (done.changes !== 1) throw new PeopleError(`No open possible duplicate ${duplicateId}`, 'not_found');
    }

    /** The open possible duplicates, oldest first. */
    duplicates(ownerId: string): Duplicate[] {
        return prepareCached<[string], { id: number; a_id: number; a_name: string | null; b_id: number; b_name: string | null; reason: string }>(
            this.db,
            `SELECT d.id, d.a_id, a.name AS a_name, d.b_id, b.name AS b_name, d.reason FROM people_duplicates d
               JOIN people a ON a.id = d.a_id JOIN people b ON b.id = d.b_id
              WHERE d.owner_id = ? AND d.status = 'open' ORDER BY d.id`,
        )
            .all(ownerId)
            .map((r) => ({ id: r.id, aId: r.a_id, aName: r.a_name, bId: r.b_id, bName: r.b_name, reason: r.reason }));
    }

    /** The active people whose summary needs rewriting (and was not written by the owner). */
    stale(ownerId: string): number[] {
        return prepareCached<[string], { id: number }>(this.db, `SELECT id FROM people WHERE owner_id = ? AND status = 'active' AND summary_stale = 1 AND summary_by_user = 0 ORDER BY id`)
            .all(ownerId)
            .map((r) => r.id);
    }

    // ---- reading ----

    /** The person's id and status; throws when the owner has no such person. */
    personRow(ownerId: string, personId: number): { id: number; status: 'active' | 'ignored' } {
        const row = prepareCached<[number, string], { id: number; status: 'active' | 'ignored' }>(this.db, `SELECT id, status FROM people WHERE id = ? AND owner_id = ?`).get(personId, ownerId);
        if (!row) throw new PeopleError(`No person ${personId}`, 'not_found');
        return row;
    }

    addresses(ownerId: string, personId: number): string[] {
        return prepareCached<[string, number], { address: string }>(this.db, `SELECT address FROM people_addresses WHERE owner_id = ? AND person_id = ? ORDER BY address`)
            .all(ownerId, personId)
            .map((r) => r.address);
    }

    /** A person's whole entry: fields, summary, addresses, facts (with whether each field fact is the current value), links and activity. */
    person(ownerId: string, personId: number): Person {
        const r = prepareCached<[number, string], PeopleRow>(this.db, `SELECT * FROM people WHERE id = ? AND owner_id = ?`).get(personId, ownerId);
        if (!r) throw new PeopleError(`No person ${personId}`, 'not_found');
        const chosen = new Set([...this.current(personId).values()].map((f) => f.id));
        const facts = prepareCached<[number], { id: number; field: FactField; text: string; evidence: string | null; source: string | null; source_date: string | null; origin: 'model' | 'user' }>(
            this.db,
            `SELECT id, field, text, evidence, source, source_date, origin FROM people_facts WHERE person_id = ? AND status = 'active'
              ORDER BY COALESCE(source_date, '') DESC, id DESC`,
        )
            .all(personId)
            .map((f) => ({
                id: f.id,
                field: f.field,
                text: f.text,
                evidence: f.evidence,
                source: sourceValue(f.source),
                sourceDate: f.source_date,
                origin: f.origin,
                current: f.field === 'note' ? true : chosen.has(f.id),
            }));
        const links = prepareCached<[number, number], { id: number; kind: LinkKind; from_id: number; to_id: number; from_name: string | null; to_name: string | null; evidence: string | null; source: string | null }>(
            this.db,
            `SELECT l.id, l.kind, l.from_id, l.to_id, f.name AS from_name, t.name AS to_name, l.evidence, l.source FROM people_links l
               JOIN people f ON f.id = l.from_id JOIN people t ON t.id = l.to_id
              WHERE l.status = 'active' AND (l.from_id = ? OR l.to_id = ?) ORDER BY l.id`,
        )
            .all(personId, personId)
            .map((l) => {
                const out = l.from_id === personId;
                return {
                    id: l.id,
                    kind: l.kind,
                    direction: out ? ('out' as const) : ('in' as const),
                    otherId: out ? l.to_id : l.from_id,
                    other: out ? l.to_name : l.from_name,
                    evidence: l.evidence,
                    source: sourceValue(l.source),
                };
            });
        const counts = new Map(
            prepareCached<[number], { direction: string; n: number }>(this.db, `SELECT direction, COUNT(*) AS n FROM people_exchanges WHERE person_id = ? GROUP BY direction`)
                .all(personId)
                .map((c) => [c.direction, c.n]),
        );
        const recent = prepareCached<[number], { subject: string | null; date: string | null; direction: 'in' | 'out'; account: string; message_id: string }>(
            this.db,
            `SELECT subject, date, direction, account, message_id FROM people_exchanges WHERE person_id = ? ORDER BY date DESC LIMIT 5`,
        ).all(personId);
        return {
            id: r.id,
            ownerId: r.owner_id,
            name: r.name,
            organisation: r.organisation,
            role: r.role,
            relationship: r.relationship,
            origin: r.origin,
            address: r.address,
            phone: r.phone,
            summary: r.summary,
            summaryByUser: r.summary_by_user === 1,
            status: r.status,
            firstContact: r.first_contact,
            lastContact: r.last_contact,
            addresses: this.addresses(ownerId, personId),
            facts,
            links,
            activity: {
                in: counts.get('in') ?? 0,
                out: counts.get('out') ?? 0,
                first: r.first_contact,
                last: r.last_contact,
                subjects: recent.map((x) => x.subject),
                recent: recent.map((x) => ({ subject: x.subject, date: x.date, direction: x.direction, account: x.account, messageId: x.message_id })),
            },
        };
    }

    /**
     * Active people, most recently in touch first. query: every word must
     * appear in what is known about them (name, organisation, role,
     * relationship, summary, notes, addresses); organisation: part of their
     * organisation's name; relationship: exactly this one. limit: at most this
     * many (50 when not given, as in Jeff Desk).
     */
    listing(ownerId: string, filter: { query?: string; organisation?: string; relationship?: string; limit?: number } = {}): PersonBrief[] {
        const limit = filter.limit ?? 50;
        const rows = prepareCached<[string], PeopleRow>(
            this.db,
            `SELECT * FROM people WHERE owner_id = ? AND status = 'active' ORDER BY last_contact IS NULL, last_contact DESC, name`,
        ).all(ownerId);
        const notes = new Map<number, string[]>();
        if (filter.query) {
            const add = (id: number, text: string) => notes.set(id, [...(notes.get(id) ?? []), text]);
            for (const n of prepareCached<[string], { person_id: number; text: string }>(this.db, `SELECT person_id, text FROM people_facts WHERE owner_id = ? AND status = 'active' AND field = 'note'`).all(ownerId)) add(n.person_id, n.text);
            for (const a of prepareCached<[string], { person_id: number; address: string }>(this.db, `SELECT person_id, address FROM people_addresses WHERE owner_id = ?`).all(ownerId)) add(a.person_id, a.address);
        }
        const out: PersonBrief[] = [];
        for (const p of rows) {
            if (filter.organisation && !norm(p.organisation).includes(norm(filter.organisation))) continue;
            if (filter.relationship && p.relationship !== filter.relationship) continue;
            if (filter.query) {
                const hay = norm([p.name, p.organisation, p.role, p.relationship, p.summary, ...(notes.get(p.id) ?? [])].filter(Boolean).join(' '));
                if (!words(norm(filter.query)).every((w) => hay.includes(w))) continue;
            }
            out.push({
                id: p.id,
                name: p.name,
                organisation: p.organisation,
                role: p.role,
                relationship: p.relationship,
                origin: p.origin,
                address: p.address,
                phone: p.phone,
                summary: p.summary,
                lastContact: p.last_contact,
                addresses: this.addresses(ownerId, p.id),
            });
            if (out.length >= limit) break;
        }
        return out;
    }

    /** People matching a name or an email address: the address, else the exact full name, else every word. */
    find(ownerId: string, text: string): Person[] {
        const t = text.trim();
        if (t.includes('@')) {
            const row = prepareCached<[string, string], { id: number }>(
                this.db,
                `SELECT p.id FROM people_addresses a JOIN people p ON p.id = a.person_id WHERE a.owner_id = ? AND a.address = ? AND p.status = 'active'`,
            ).get(ownerId, t.toLowerCase());
            return row ? [this.person(ownerId, row.id)] : [];
        }
        const exact = this.named(ownerId, t);
        if (exact.length) return exact.map((p) => this.person(ownerId, p.id));
        return this.listing(ownerId, { query: t, limit: LOOKUP_MATCHES }).map((p) => this.person(ownerId, p.id));
    }

    /** One plain line about a person, for prompts. */
    line(p: Person): string {
        const first = p.addresses[0];
        const head = p.name ?? first;
        if (head === undefined) throw new PeopleError(`person ${p.id} has neither a name nor an address`, 'invalid_request');
        const what =
            [p.role, p.organisation].filter(Boolean).join(' at ') + (p.relationship ? `, ${p.relationship}` : '') + (p.origin ? ` (${p.origin})` : '');
        const trimmed = what.replace(/^[, ]+|[, ]+$/g, '');
        const act = p.activity;
        const n = (count: number) => `${count} email${count === 1 ? '' : 's'}`;
        const talk = act.last ? `${n(act.in)} from them, ${act.out} to them, last ${act.last.slice(0, 10)}` : 'no email exchanged';
        return head + (p.name && first ? ` (${first})` : '') + (trimmed ? `: ${trimmed}` : '') + `; ${talk}`;
    }

    /**
     * People a chat message names: by email address, by full name, or by a
     * single first name or surname (written with a capital letter) that
     * belongs to exactly one active person among the TOP the owner exchanges
     * most email with. In the order they are named.
     */
    mentioned(ownerId: string, text: string, limit = 3): Person[] {
        const found: Array<[number, number]> = [];
        const people = prepareCached<[string], { id: number; name: string }>(this.db, `SELECT id, name FROM people WHERE owner_id = ? AND status = 'active' AND name IS NOT NULL ORDER BY id`).all(ownerId);
        const top = new Set(
            prepareCached<[string, number], { person_id: number }>(
                this.db,
                `SELECT person_id, COUNT(*) AS n FROM people_exchanges WHERE owner_id = ? GROUP BY person_id ORDER BY n DESC LIMIT ?`,
            )
                .all(ownerId, TOP)
                .map((r) => r.person_id),
        );
        for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
            const row = prepareCached<[string, string], { id: number }>(
                this.db,
                `SELECT p.id FROM people_addresses a JOIN people p ON p.id = a.person_id WHERE a.owner_id = ? AND a.address = ? AND p.status = 'active'`,
            ).get(ownerId, m[0].toLowerCase());
            if (row) found.push([text.toLowerCase().indexOf(m[0].toLowerCase()), row.id]);
        }
        const lowered = ` ${norm(text.replace(/[^\p{L}\p{N}_\s'-]/gu, ' '))} `;
        for (const p of people) {
            if (!fullName(p.name)) continue;
            const at = lowered.indexOf(` ${norm(p.name)} `);
            if (at >= 0) found.push([at, p.id]);
        }
        for (const m of text.matchAll(/\b[A-Z][\p{L}\p{N}_'-]+/gu)) {
            const word = m[0].toLowerCase();
            const owners = people.filter((p) => {
                const w = words(norm(p.name));
                return w.length > 0 && (w[0] === word || w[w.length - 1] === word);
            });
            if (owners.length === 1 && top.has(owners[0]!.id)) found.push([m.index, owners[0]!.id]);
        }
        const ids = [...new Set(found.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, id]) => id))];
        return ids.slice(0, limit).map((id) => this.person(ownerId, id));
    }
}
