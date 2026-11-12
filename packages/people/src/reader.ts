import { fill, prompt } from './prompts.js';
import { LINKS, NOTE_LIMIT, RELATIONSHIPS, PeopleError, fullName, norm, organisationName, tidyName, type Person, type PersonSource, type PeopleStore } from './store.js';

/**
 * Reading people from email into the people directory. Ported from Jeff
 * Desk (jeff_desk/people.py).
 *
 *   an email (received or sent)  only a substantive one (not spam, cold pitches, newsletters or notifications). Its
 *                                people come from the address lines (in code: who wrote, who received), and from the
 *                                model: their organisation, role and relationship to the owner, links between them,
 *                                and other lasting facts, each with the exact words of the email that show it
 *   a chat fact                  something the owner said about a person
 *   summaries                    each changed person's short description, rewritten from their facts
 *
 * Every piece of evidence must really be in the email (checked in code);
 * what is not is dropped and counted as rejected. A model answer that is not
 * what was asked for throws PeopleReadError and nothing from it is kept.
 * Each email is read once: the directory records it as done, skipped (with
 * why) or failed (with the error, so it can be read again).
 */

/** Characters of an email's body given to the model. */
export const MAX_TEXT = 6000;
/** An email to more people than this is a mass mailing: only its sender is recorded. */
export const MASS = 12;
/** Words of evidence a relationship, a link, an origin or a note needs (one word, such as a domain, proves nothing). */
export const SHORTEST = 3;
/** The newest notes about a person given to the model for the summary. */
export const NOTES_SHOWN = 8;
/** "other" is the owner's to give, never the model's. */
const MODEL_RELATIONSHIPS: readonly string[] = RELATIONSHIPS.filter((r) => r !== 'other');

/** Addresses no person writes from (the part before the @). */
const AUTOMATED = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|newsletters?|marketing|alerts?)([+._-].*)?$/i;

// Words that tie a note to a moment (a day, a time, a date): such a note is about this week, not about the person.
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const TRANSIENT = new RegExp(
    String.raw`\b(today|tonight|tomorrow|yesterday|this (morning|afternoon|evening|week|month)|next (week|month|year|monday|tuesday|` +
        String.raw`wednesday|thursday|friday)|last (week|month)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|` +
        String.raw`\d{1,2}(:\d{2})?\s?(am|pm)|\d{4}-\d{2}-\d{2}|\d{1,2}(st|nd|rd|th)? (` +
        MONTHS +
        String.raw`)|(` +
        MONTHS +
        String.raw`) \d{1,2}\b)`,
    'i',
);

// An address line (From:, To:, Cc:, Subject: ...), including those of earlier emails quoted in a reply: it shows who was
// on an email, never how they relate or what they do.
const ADDRESS_LINE = /^\s*(from|to|cc|bcc|subject|sent|date|reply-to)\s*:/i;
const FILLER = new Set(['works', 'work', 'working', 'based', 'the', 'at', 'of', 'a', 'an', 'for', 'in', 'with', 'and', 'is', 'as', 'co', 'ltd', 'inc', 'llp', 'plc', 'limited']);

// Shared mailboxes and teams: an email from one may matter, but the mailbox is not a person. Words that say so anywhere
// in the address (sdfsupport@, lon-office@, tsp.inquiry@), a whole word of it (info@, hr@), or a word of the display
// name ("Scissero Recruitment", "London Office"); and an address with a number of four digits or more (esc-2027@).
const TEAM_INSIDE = ['support', 'admin', 'recruit', 'orders', 'office', 'inquir', 'enquir', 'events', 'helpdesk', 'noreply', 'careers', 'billing', 'invoice'];
const TEAM_WORDS = new Set(['help', 'info', 'hello', 'contact', 'account', 'accounts', 'team', 'sales', 'service', 'services', 'reception', 'hr', 'jobs', 'manager', 'managers', 'desk', 'press', 'media']);
const TEAM_NAMES = new Set(['recruitment', 'office', 'inquiry', 'enquiries', 'support', 'team', 'orders', 'circumstances', 'desk', 'helpdesk', 'events', 'admin', 'accounts', 'sponsor', 'notifications']);

export class PeopleReadError extends Error {
    readonly code = 'bad_model_answer';
    constructor(message: string) {
        super(message);
        this.name = 'PeopleReadError';
    }
}

/** Text reduced to lower-case words (and @ . $ £ € %), so a quote is found whatever the spacing and punctuation. */
export function plain(text: string | null | undefined): string {
    return (text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_@.$£€%]+/gu, ' ')
        .split(' ')
        .filter(Boolean)
        .join(' ');
}

function answerJson(text: string): Record<string, unknown> {
    const found = text.match(/\{[\s\S]*\}/);
    if (!found) throw new PeopleReadError(`the model's answer is not a JSON object: ${text.slice(0, 200)}`);
    try {
        return JSON.parse(found[0]) as Record<string, unknown>;
    } catch (err) {
        throw new PeopleReadError(`the model's answer is not valid JSON (${err instanceof Error ? err.message : String(err)}): ${text.slice(0, 200)}`);
    }
}

/** The name a first.last@ address spells out (dan.rosenberg@ is Dan Rosenberg), or null. */
export function nameFromAddress(address: string | null | undefined): string | null {
    const found = (address ?? '').split('@')[0]!.toLowerCase().match(/^([a-z]{2,})[._]([a-z]{2,})$/);
    const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
    return found ? `${cap(found[1]!)} ${cap(found[2]!)}` : null;
}

/** Whether an address (with its display name) is a shared mailbox or a team, not a person. */
export function shared(address: string | null | undefined, name?: string | null): boolean {
    const box = (address ?? '').split('@')[0]!.toLowerCase();
    const parts = box.split(/[._+-]+/);
    if (TEAM_INSIDE.some((w) => box.includes(w)) || parts.some((w) => TEAM_WORDS.has(w)) || parts.some((w) => /^\d{4,}$/.test(w))) return true;
    return !!name && (name.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => TEAM_NAMES.has(w));
}

/** Whether an address is one no person writes from (noreply@, notifications@, ...). */
export function automated(address: string | null | undefined): boolean {
    return AUTOMATED.test((address ?? '').split('@')[0]!);
}

/** Whether a note says nothing beyond the person's name, organisation, role and relationship. */
function onlyRepeats(note: string, person: Person): boolean {
    const set = (t: string | null) => new Set((t ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const known = set([person.name, person.organisation, person.role, person.relationship].filter(Boolean).join(' '));
    return [...set(note)].every((w) => known.has(w) || FILLER.has(w));
}

/** A link between two people as a plain sentence. */
function linkSentence(a: string | null, kind: string, b: string | null, user: string): string {
    switch (kind) {
        case 'works_with':
            return `${a} works with ${b}.`;
        case 'reports_to':
            return `${a} reports to ${b}.`;
        case 'assistant_to':
            return `${a} is the assistant of ${b}.`;
        case 'introduced_by':
            return `${a} was introduced to ${user} by ${b}.`;
        case 'family_of':
            return `${a} is family of ${b}.`;
        default:
            return `${a} is linked to ${b}.`;
    }
}

export interface EmailPerson {
    name: string | null;
    address: string;
    role: 'from' | 'to' | 'cc' | 'bcc';
}

export interface ReaderEmail {
    messageId: string;
    subject: string | null;
    date: string | null;
    body: string;
    /** Everyone on the email's address lines, with their display names. */
    people: EmailPerson[];
}

export interface ReadResult {
    outcome: 'done' | 'skipped';
    reason: string | null;
    /** The ids of the people the email was read into. */
    people: number[];
    facts: number;
    links: number;
    /** Items of the model's answer dropped because their evidence is not in the email (or they break a rule). */
    rejected: number;
}

export interface ReaderOptions {
    store: PeopleStore;
    /** The model: a prompt in, its text answer out. */
    write: (prompt: string, maxTokens: number) => Promise<string>;
    /** Whose directory this is: every row read is theirs. */
    ownerId: string;
    /** The owner's full name, as the prompts call them. */
    ownerName: string;
    /** The owner's own email addresses: they are never a person in their own directory. */
    ownerAddresses: string[];
    /** The date as text for the prompts, e.g. "Thursday 12 November 2026 (2026-11-12)". */
    today: () => string;
    /** Who the owner is, in their own words (an "About me" text); empty when they have not written one. */
    about: () => string;
}

interface Placed {
    name: string | null;
    address: string;
    role: EmailPerson['role'];
}

const shown = (p: Placed) => (p.name ? `${p.name} <${p.address}>` : p.address);
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export class PeopleReader {
    private readonly mine: Set<string>;

    constructor(private readonly o: ReaderOptions) {
        if (!o.ownerName.trim()) throw new PeopleError("the reader needs the owner's name", 'invalid_request');
        this.mine = new Set(o.ownerAddresses.filter(Boolean).map((a) => a.toLowerCase()));
    }

    private get store(): PeopleStore {
        return this.o.store;
    }

    /** Read one email (received, or sent by the owner) into the directory. */
    async email(message: ReaderEmail, sent: boolean, account: string): Promise<ReadResult> {
        const kind = sent ? 'sent_email' : 'email';
        const done = this.store.processed(this.o.ownerId, account, message.messageId);
        if (done && done.outcome !== 'failed') return { outcome: 'skipped', reason: 'already read', people: [], facts: 0, links: 0, rejected: 0 };
        if (!Array.isArray(message.people)) throw new PeopleReadError(`the email ${message.messageId} does not list its people`);
        const everyone: Placed[] = message.people.filter((p) => p.address).map((p) => ({ name: tidyName(p.name), address: p.address.toLowerCase(), role: p.role }));
        const sender = everyone.find((p) => p.role === 'from');
        if (!sent && sender && automated(sender.address)) {
            this.store.mark(this.o.ownerId, account, message.messageId, kind, 'skipped', `automated sender ${sender.address}`);
            return { outcome: 'skipped', reason: 'automated sender', people: [], facts: 0, links: 0, rejected: 0 };
        }
        try {
            return await this.read(message, sent, account, kind, everyone);
        } catch (err) {
            // Recorded as failed so it can be read again, then thrown on as it is.
            this.store.mark(this.o.ownerId, account, message.messageId, kind, 'failed', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
            throw err;
        }
    }

    private async read(message: ReaderEmail, sent: boolean, account: string, kind: string, everyone: Placed[]): Promise<ReadResult> {
        const owner = this.o.ownerId;
        const recipients = everyone.filter((p) => p.role === 'to' || p.role === 'cc');
        const me = norm(this.o.ownerName); // the owner at another address (an old firm's, a group company's) is still the owner
        let humans = everyone.filter(
            (p) => !this.mine.has(p.address) && !automated(p.address) && !shared(p.address, p.name) && !organisationName(p.name) && norm(p.name ?? nameFromAddress(p.address)) !== me,
        );
        const mass = recipients.length > MASS;
        if (mass) humans = humans.filter((p) => p.role === 'from'); // a mass mailing: its sender only
        const head = (role: string, label: string) => (everyone.some((p) => p.role === role) ? [`${label}: ${everyone.filter((p) => p.role === role).map(shown).join(', ')}`] : []);
        // For a mass mailing the model is shown how many received it, not who (it would list them all).
        const text = [
            ...head('from', 'From'),
            ...(mass ? [`To: ${recipients.length} recipients`] : [...head('to', 'To'), ...head('cc', 'Cc')]),
            `Subject: ${message.subject || '(none)'}`,
            `Date: ${message.date || 'unknown'}`,
            '',
            (message.body ?? '').slice(0, MAX_TEXT),
        ].join('\n');
        const known: string[] = [];
        const knownActivity = new Set<string>();
        for (const p of humans) {
            const found = this.store.find(owner, p.address);
            if (found.length) {
                known.push(`- ${this.store.line(found[0]!)}`);
                if (found[0]!.activity.in || found[0]!.activity.out) knownActivity.add(p.address);
            }
        }
        const prior = humans.filter((p) => p.role === 'from' && knownActivity.has(p.address));
        const p = fill(prompt('people/read_email'), {
            prior: prior.length ? fill(prompt('people/prior_yes'), { who: prior.map(shown).join(', ') }) : prompt('people/prior_no'),
            // The prompt's own wording for an owner who has not described themselves yet.
            about: this.o.about() || '(not written yet)',
            direction: sent ? 'that the user sent' : 'that the user received',
            user: this.o.ownerName,
            addresses: [...this.mine].sort().join(', '),
            today: this.o.today(),
            date: message.date || 'unknown',
            relationships: prompt('people/relationships'),
            known: known.join('\n') || '(nothing yet)',
            email: text,
        });
        const answer = answerJson(await this.o.write(p, 3000));
        if (answer.skip === true) {
            if (!(typeof answer.why === 'string' && answer.why.trim())) throw new PeopleReadError(`the answer skips the email without saying why: ${JSON.stringify(answer).slice(0, 200)}`);
            const reason = `not substantive: ${answer.why.split(/\s+/).filter(Boolean).join(' ')}`;
            this.store.mark(owner, account, message.messageId, kind, 'skipped', reason);
            return { outcome: 'skipped', reason, people: [], facts: 0, links: 0, rejected: 0 };
        }
        this.check(answer);
        const people = answer.people as Array<Record<string, string | null | undefined>>;
        const links = answer.links as Array<Record<string, string | null | undefined>>;
        const notes = answer.notes as Array<Record<string, string | null | undefined>>;

        const source: PersonSource = { kind, account, messageId: message.messageId, subject: message.subject };
        const date = message.date;
        const words = plain(text);
        const lowered = text.toLowerCase();
        const bodyWords = plain((message.body ?? '').slice(0, MAX_TEXT)); // the address lines show who was on an email, not how they relate
        const quoted = (evidence: unknown): evidence is string => typeof evidence === 'string' && !!plain(evidence) && words.includes(plain(evidence)) && !ADDRESS_LINE.test(evidence);
        const long = (evidence: string) => plain(evidence).split(' ').length >= SHORTEST;
        let rejected = 0;
        let facts = 0;
        let linked = 0;

        // The address lines, in code: who is in the email, and who wrote to whom.
        const index = new Map<string, number>();
        for (const h of humans) {
            const pid = this.store.place(owner, { name: h.name ?? nameFromAddress(h.address), address: h.address, source, sourceDate: date });
            if (pid === null) continue; // marked not relevant
            index.set(h.address, pid);
            if (h.name) index.set(norm(h.name), pid);
            if ((sent && (h.role === 'to' || h.role === 'cc')) || (!sent && h.role === 'from')) {
                this.store.exchange(owner, pid, { account, messageId: message.messageId, direction: sent ? 'out' : 'in', date, subject: message.subject });
            }
        }
        const ignored = new Set(everyone.filter((e) => !index.has(e.address)).map((e) => e.address));
        // By name too: mass-mail recipients, people not relevant.
        const unplaced = new Set(everyone.filter((e) => e.name && !index.has(e.address)).map((e) => norm(e.name)));
        const isOwner = (name: string, address: string | null) => this.mine.has((address ?? '').toLowerCase()) || norm(name) === me;

        // The model's people: each detail kept only with words of the email that show it.
        for (const item of people) {
            const name = item.name as string;
            const address = (item.email ?? '').trim().toLowerCase() || null;
            if (isOwner(name, address) || (!address && unplaced.has(norm(name)))) continue;
            if (address && !lowered.includes(address)) {
                rejected++;
                continue;
            }
            if (organisationName(name)) {
                rejected++; // an organisation, not a person
                continue;
            }
            if ((address && ignored.has(address)) || (!address && !fullName(name))) continue;
            const details: Array<[field: 'organisation' | 'role' | 'relationship' | 'origin' | 'address' | 'phone', value: string, evidence: string]> = [];
            for (const field of ['organisation', 'role', 'relationship', 'origin', 'address', 'phone'] as const) {
                const value = item[field];
                if (!(typeof value === 'string' && value.trim())) continue;
                const evidence = item[`${field}_evidence`];
                if (
                    !quoted(evidence) ||
                    (field === 'relationship' && (!MODEL_RELATIONSHIPS.includes(value.trim().toLowerCase()) || !long(evidence))) ||
                    (field === 'origin' && !long(evidence)) ||
                    ((field === 'relationship' || field === 'origin') && !bodyWords.includes(plain(evidence))) ||
                    ((field === 'address' || field === 'phone') && !words.includes(plain(value))) // written in the email, as it is
                ) {
                    rejected++;
                    continue;
                }
                details.push([field, value, evidence]);
            }
            const named = !!plain(name) && words.includes(plain(name));
            let pid = address ? index.get(address) : index.get(norm(name));
            if (pid === undefined) {
                if (!named) {
                    rejected++; // someone the email does not name
                    continue;
                }
                const placed = this.store.place(owner, { name, address, organisation: details.find(([f]) => f === 'organisation')?.[1] ?? null, source, sourceDate: date });
                if (placed === null) continue;
                pid = placed;
            }
            if (address) index.set(address, pid);
            index.set(norm(name), pid);
            if (named && fullName(name) && this.store.addFact(owner, pid, { field: 'name', text: name, evidence: name, source, sourceDate: date }) !== null) facts++;
            for (const [field, value, evidence] of details) {
                if (this.store.addFact(owner, pid, { field, text: value, evidence, source, sourceDate: date }) !== null) facts++;
            }
        }
        const who = (name: string | null | undefined) => index.get((name ?? '').trim().toLowerCase()) ?? index.get(norm(name));
        for (const item of links) {
            const a = who(item.from);
            const b = who(item.to);
            if (!(LINKS as readonly string[]).includes(item.kind ?? '') || !quoted(item.evidence) || !long(item.evidence) || a === undefined || b === undefined || a === b) {
                rejected++;
                continue;
            }
            if (this.store.addLink(owner, { from: a, kind: item.kind!, to: b, evidence: item.evidence, source, sourceDate: date }) !== null) linked++;
        }
        for (const item of notes) {
            const pid = who(item.person);
            const noteText = item.text;
            if (
                pid === undefined ||
                !quoted(item.evidence) ||
                !long(item.evidence) ||
                !(typeof noteText === 'string' && noteText.trim()) ||
                [...noteText].length > NOTE_LIMIT ||
                TRANSIENT.test(noteText) ||
                onlyRepeats(noteText, this.store.person(owner, pid))
            ) {
                rejected++;
                continue;
            }
            if (this.store.addFact(owner, pid, { field: 'note', text: noteText, evidence: item.evidence, source, sourceDate: date }) !== null) facts++;
        }
        this.store.mark(owner, account, message.messageId, kind, 'done');
        return { outcome: 'done', reason: null, people: [...new Set(index.values())].sort((x, y) => x - y), facts, links: linked, rejected };
    }

    /**
     * The whole answer is checked before anything is written, so a bad answer
     * leaves nothing behind: three lists of objects, every person with a
     * name, and every value text or null.
     */
    private check(answer: Record<string, unknown>): void {
        for (const key of ['people', 'links', 'notes']) {
            if (!Array.isArray(answer[key])) throw new PeopleReadError(`the answer has no "${key}" list: ${JSON.stringify(answer).slice(0, 200)}`);
            for (const item of answer[key] as unknown[]) {
                if (!isObject(item)) throw new PeopleReadError(`an item of "${key}" is not an object: ${JSON.stringify(item).slice(0, 200)}`);
                for (const [k, v] of Object.entries(item)) {
                    if (v !== null && typeof v !== 'string') throw new PeopleReadError(`"${k}" of an item of "${key}" is neither text nor null: ${JSON.stringify(item).slice(0, 200)}`);
                }
            }
        }
        for (const item of answer.people as Array<Record<string, unknown>>) {
            if (typeof item.name !== 'string') throw new PeopleReadError(`a person has no name: ${JSON.stringify(item).slice(0, 200)}`);
        }
    }

    /**
     * Something the owner said about a person, kept as a note; the person's
     * id, or null when the words do not say who it is well enough (an email
     * address, a full name, or a name only one person in the directory has):
     * then it is not the directory's to keep. source: where it was said.
     */
    chatFact(person: string, text: string, evidence: string, source: PersonSource): number | null {
        const owner = this.o.ownerId;
        const p = person.trim();
        if (organisationName(p)) return null; // an organisation: not a person
        let pid: number | null;
        if (p.includes('@') || fullName(p)) {
            if (this.mine.has(p.toLowerCase()) || norm(p) === norm(this.o.ownerName)) return null;
            pid = this.store.place(owner, { name: p.includes('@') ? null : p, address: p.includes('@') ? p : null });
        } else {
            const word = norm(p);
            const owners = this.store
                .listing(owner, { limit: Number.POSITIVE_INFINITY })
                .filter((x) => {
                    const w = norm(x.name).split(' ').filter(Boolean);
                    return word && w.length > 0 && (w[0] === word || w[w.length - 1] === word);
                })
                .map((x) => x.id);
            pid = owners.length === 1 ? owners[0]! : null;
        }
        if (pid === null) return null;
        this.store.addFact(owner, pid, { field: 'note', text, evidence, source, sourceDate: this.store.today() });
        return pid;
    }

    /**
     * Rewrite the short description of each person whose facts changed (all of
     * them, or those among `ids`); how many were written. An empty answer
     * throws PeopleReadError and the person stays marked for rewriting.
     */
    async summaries(ids?: number[]): Promise<number> {
        const owner = this.o.ownerId;
        const user = this.o.ownerName;
        let count = 0;
        for (const pid of this.store.stale(owner).filter((i) => ids === undefined || ids.includes(i))) {
            const p = this.store.person(owner, pid);
            const name = p.name ?? p.addresses[0];
            if (name === undefined) throw new PeopleError(`person ${pid} has neither a name nor an address`, 'invalid_request');
            const shownNotes = new Set(p.facts.filter((f) => f.field === 'note').slice(0, NOTES_SHOWN).map((f) => f.id));
            const lines = p.facts
                .filter((f) => f.field !== 'note' || shownNotes.has(f.id))
                .map((f) => `- ${f.field}: ${f.text}` + (f.sourceDate ? ` (${f.sourceDate.slice(0, 10)})` : ''));
            for (const l of p.links) {
                lines.push(`- ${linkSentence(l.direction === 'out' ? name : l.other, l.kind, l.direction === 'out' ? l.other : name, user)}`);
            }
            if (p.activity.last) lines.push(`- emails: ${p.activity.in} from them, ${p.activity.out} from ${user}, last on ${p.activity.last.slice(0, 10)}`);
            const text = (await this.o.write(fill(prompt('people/summary'), { name, user, facts: lines.join('\n') || '- (no facts yet)' }), 400)).trim();
            if (!text) throw new PeopleReadError(`the model wrote an empty description of ${name}`);
            this.store.setSummary(owner, pid, text, false);
            count++;
        }
        return count;
    }
}
