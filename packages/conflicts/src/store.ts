import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';
import { nameSimilarity, normalizeName } from './match.js';

export type PartyKind = 'organisation' | 'person';

export interface Party {
    id: string;
    name: string;
    kind: PartyKind;
    aliases: string[];
    createdBy: string;
    createdAt: number;
}

export interface SubjectRef {
    type: string;
    id: string;
}

/** A party's place on a subject, e.g. ('matter', id) as 'client'. Roles are host-defined. */
export interface PartyLink {
    partyId: string;
    subject: SubjectRef;
    role: string;
    addedBy: string;
    addedAt: number;
}

export interface CheckQuery {
    name: string;
    role: string;
}

export interface CheckHit {
    query: CheckQuery;
    party: Party;
    score: number;
    /** The name or alias that matched. */
    matchedOn: string;
    links: PartyLink[];
}

export type CheckDecision = 'pending' | 'clear' | 'waived' | 'declined';

export interface ConflictCheck {
    id: string;
    /** The subject the check was for; null until it exists (e.g. before a matter is opened). */
    subject: SubjectRef | null;
    queries: CheckQuery[];
    hits: CheckHit[];
    requestedBy: string;
    requestedAt: number;
    decision: CheckDecision;
    decidedBy: string | null;
    decidedAt: number | null;
    note: string;
}

export const CONFLICTS_MIGRATIONS: Migration[] = [
    {
        name: '20261111_create_conflicts',
        up: `
            CREATE TABLE IF NOT EXISTS parties (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                normalized TEXT NOT NULL,
                kind       TEXT NOT NULL CHECK (kind IN ('organisation', 'person')),
                aliases    TEXT NOT NULL DEFAULT '[]',
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_parties_normalized ON parties(normalized);

            CREATE TABLE IF NOT EXISTS party_links (
                party_id     TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
                subject_type TEXT NOT NULL,
                subject_id   TEXT NOT NULL,
                role         TEXT NOT NULL,
                added_by     TEXT NOT NULL,
                added_at     INTEGER NOT NULL,
                PRIMARY KEY (party_id, subject_type, subject_id, role)
            );
            CREATE INDEX IF NOT EXISTS idx_party_links_subject ON party_links(subject_type, subject_id);

            CREATE TABLE IF NOT EXISTS conflict_checks (
                id           TEXT PRIMARY KEY,
                subject_type TEXT,
                subject_id   TEXT,
                queries      TEXT NOT NULL,
                hits         TEXT NOT NULL,
                requested_by TEXT NOT NULL,
                requested_at INTEGER NOT NULL,
                decision     TEXT NOT NULL CHECK (decision IN ('pending', 'clear', 'waived', 'declined')),
                decided_by   TEXT,
                decided_at   INTEGER,
                note         TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_conflict_checks_subject ON conflict_checks(subject_type, subject_id);
        `,
    },
    {
        // How to recognise a party in mail: its email addresses and its own domains.
        name: '20261112_party_contacts',
        up: `
            CREATE TABLE IF NOT EXISTS party_contacts (
                party_id   TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
                value      TEXT NOT NULL,
                added_by   TEXT NOT NULL,
                added_at   INTEGER NOT NULL,
                PRIMARY KEY (party_id, value)
            );
            CREATE INDEX IF NOT EXISTS idx_party_contacts_value ON party_contacts(value);
        `,
    },
];

interface PartyRow {
    id: string;
    name: string;
    normalized: string;
    kind: PartyKind;
    aliases: string;
    created_by: string;
    created_at: number;
}
interface LinkRow {
    party_id: string;
    subject_type: string;
    subject_id: string;
    role: string;
    added_by: string;
    added_at: number;
}
interface CheckRow {
    id: string;
    subject_type: string | null;
    subject_id: string | null;
    queries: string;
    hits: string;
    requested_by: string;
    requested_at: number;
    decision: CheckDecision;
    decided_by: string | null;
    decided_at: number | null;
    note: string;
}

const toParty = (r: PartyRow): Party => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    aliases: JSON.parse(r.aliases) as string[],
    createdBy: r.created_by,
    createdAt: r.created_at,
});
const toLink = (r: LinkRow): PartyLink => ({
    partyId: r.party_id,
    subject: { type: r.subject_type, id: r.subject_id },
    role: r.role,
    addedBy: r.added_by,
    addedAt: r.added_at,
});
const toCheck = (r: CheckRow): ConflictCheck => ({
    id: r.id,
    subject: r.subject_type && r.subject_id ? { type: r.subject_type, id: r.subject_id } : null,
    queries: JSON.parse(r.queries) as CheckQuery[],
    hits: JSON.parse(r.hits) as CheckHit[],
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    decision: r.decision,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    note: r.note,
});

export interface PartyRegisterOptions {
    db: DatabaseInstance;
    /** Similarity from which a name counts as a possible match. Default 0.85. */
    threshold?: number;
    now?: () => number;
    idFactory?: () => string;
}

/**
 * The parties register and conflict checks. A check compares each queried
 * name with every party and alias, and keeps a snapshot of what it found
 * (with where each party appears) so the record shows what the person who
 * decided actually saw.
 */
/** Domains anyone can get an address at: never a party's own domain. */
export const FREE_MAIL = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de',
    't-online.de', 'bluewin.ch', 'yandex.com', 'mail.com', 'zoho.com',
]);

export class PartyRegister {
    private readonly db: DatabaseInstance;
    private readonly threshold: number;
    private readonly clock: () => number;
    private readonly newId: () => string;

    constructor(opts: PartyRegisterOptions) {
        this.db = opts.db;
        this.threshold = opts.threshold ?? 0.85;
        this.clock = opts.now ?? (() => Date.now());
        this.newId = opts.idFactory ?? (() => randomUUID());
    }

    get(id: string): Party | null {
        const row = prepareCached<[string], PartyRow>(this.db, `SELECT * FROM parties WHERE id = ?`).get(id);
        return row ? toParty(row) : null;
    }

    /** The party with exactly this name (after normalising), or a new one. */
    findOrCreate(name: string, kind: PartyKind, by: string): Party {
        const clean = name.trim();
        if (!clean) throw new Error('a party needs a name');
        if (kind !== 'organisation' && kind !== 'person') throw new Error("kind must be 'organisation' or 'person'");
        const normalized = normalizeName(clean);
        const existing = prepareCached<[string, string], PartyRow>(
            this.db,
            `SELECT * FROM parties WHERE normalized = ? AND kind = ? ORDER BY created_at LIMIT 1`,
        ).get(normalized, kind);
        if (existing) return toParty(existing);
        const id = this.newId();
        prepareCached(
            this.db,
            `INSERT INTO parties (id, name, normalized, kind, aliases, created_by, created_at) VALUES (?, ?, ?, ?, '[]', ?, ?)`,
        ).run(id, clean, normalized, kind, by, this.clock());
        return this.get(id)!;
    }

    addAlias(partyId: string, alias: string): Party {
        const party = this.get(partyId);
        if (!party) throw new Error(`No party with id ${partyId}.`);
        const clean = alias.trim();
        if (!clean) throw new Error('an alias needs a name');
        if (!party.aliases.includes(clean)) {
            prepareCached(this.db, `UPDATE parties SET aliases = ? WHERE id = ?`).run(JSON.stringify([...party.aliases, clean]), partyId);
        }
        return this.get(partyId)!;
    }

    link(partyId: string, subject: SubjectRef, role: string, by: string): PartyLink {
        if (!this.get(partyId)) throw new Error(`No party with id ${partyId}.`);
        if (!role.trim()) throw new Error('a role is required');
        prepareCached(
            this.db,
            `INSERT OR IGNORE INTO party_links (party_id, subject_type, subject_id, role, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(partyId, subject.type, subject.id, role.trim(), by, this.clock());
        return toLink(
            prepareCached<[string, string, string, string], LinkRow>(
                this.db,
                `SELECT * FROM party_links WHERE party_id = ? AND subject_type = ? AND subject_id = ? AND role = ?`,
            ).get(partyId, subject.type, subject.id, role.trim())!,
        );
    }

    unlink(partyId: string, subject: SubjectRef, role: string): boolean {
        return (
            prepareCached(
                this.db,
                `DELETE FROM party_links WHERE party_id = ? AND subject_type = ? AND subject_id = ? AND role = ?`,
            ).run(partyId, subject.type, subject.id, role).changes > 0
        );
    }

    /** Parties on a subject with their roles. */
    partiesOf(subject: SubjectRef): Array<Party & { role: string; addedBy: string; addedAt: number }> {
        return prepareCached<[string, string], PartyRow & LinkRow>(
            this.db,
            `SELECT p.*, l.role, l.added_by, l.added_at FROM party_links l JOIN parties p ON p.id = l.party_id
             WHERE l.subject_type = ? AND l.subject_id = ? ORDER BY l.added_at, p.name`,
        )
            .all(subject.type, subject.id)
            .map((r) => ({ ...toParty(r), role: r.role, addedBy: r.added_by, addedAt: r.added_at }));
    }

    linksOf(partyId: string): PartyLink[] {
        return prepareCached<[string], LinkRow>(this.db, `SELECT * FROM party_links WHERE party_id = ? ORDER BY added_at`)
            .all(partyId)
            .map(toLink);
    }

    /**
     * Add how to recognise a party in mail: an email address
     * (`tom@widget.com`) or one of its own domains (`@widget.com`). Free-mail
     * domains (gmail.com and the like) are refused as domains: they say
     * nothing about who someone works for.
     */
    addContact(partyId: string, value: string, by: string): string {
        if (!this.get(partyId)) throw new Error(`No party with id ${partyId}.`);
        const v = value.trim().toLowerCase();
        const isDomain = v.startsWith('@');
        if (isDomain ? !/^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) : !/^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) {
            throw new Error(`"${value}" is neither an email address nor a domain written @example.com`);
        }
        if (isDomain && FREE_MAIL.has(v.slice(1))) throw new Error(`${v} is a free-mail domain; add the person's address instead`);
        prepareCached(this.db, `INSERT OR IGNORE INTO party_contacts (party_id, value, added_by, added_at) VALUES (?, ?, ?, ?)`).run(
            partyId,
            v,
            by,
            this.clock(),
        );
        return v;
    }

    removeContact(partyId: string, value: string): boolean {
        return prepareCached(this.db, `DELETE FROM party_contacts WHERE party_id = ? AND value = ?`).run(partyId, value.trim().toLowerCase()).changes > 0;
    }

    contactsOf(partyId: string): string[] {
        return prepareCached<[string], { value: string }>(this.db, `SELECT value FROM party_contacts WHERE party_id = ? ORDER BY value`)
            .all(partyId)
            .map((r) => r.value);
    }

    /** The parties an email address belongs to: by the address itself, or by its domain. */
    partiesForAddress(address: string): Party[] {
        const a = address.trim().toLowerCase();
        const at = a.lastIndexOf('@');
        if (at < 1) return [];
        return prepareCached<[string, string], PartyRow>(
            this.db,
            `SELECT DISTINCT p.* FROM party_contacts c JOIN parties p ON p.id = c.party_id WHERE c.value = ? OR c.value = ? ORDER BY p.name`,
        )
            .all(a, a.slice(at))
            .map(toParty);
    }

    /** Remove a subject's party links (e.g. when it is deleted). Parties and past checks stay. */
    unlinkSubject(subject: SubjectRef): number {
        return prepareCached(this.db, `DELETE FROM party_links WHERE subject_type = ? AND subject_id = ?`).run(
            subject.type,
            subject.id,
        ).changes;
    }

    /** Parties whose name or an alias is similar to `name`, best first. */
    search(name: string): Array<{ party: Party; score: number; matchedOn: string }> {
        const found: Array<{ party: Party; score: number; matchedOn: string }> = [];
        for (const row of prepareCached<[], PartyRow>(this.db, `SELECT * FROM parties`).all()) {
            const party = toParty(row);
            let best = { score: 0, matchedOn: party.name };
            for (const candidate of [party.name, ...party.aliases]) {
                const score = nameSimilarity(name, candidate);
                if (score > best.score) best = { score, matchedOn: candidate };
            }
            if (best.score >= this.threshold) found.push({ party, ...best });
        }
        return found.sort((a, b) => b.score - a.score);
    }

    /**
     * Run a conflict check: every queried name against the register, with
     * where each matching party appears. Links to `exclude` (the subject
     * being checked, if it already exists) are left out. The check is saved
     * as `pending` until someone decides.
     */
    check(queries: CheckQuery[], requestedBy: string, opts: { subject?: SubjectRef | null } = {}): ConflictCheck {
        const clean = queries.map((q) => ({ name: q.name.trim(), role: q.role.trim() })).filter((q) => q.name);
        if (clean.length === 0) throw new Error('a conflict check needs at least one name');
        const exclude = opts.subject ?? null;
        const hits: CheckHit[] = [];
        for (const query of clean) {
            for (const m of this.search(query.name)) {
                const links = this.linksOf(m.party.id).filter(
                    (l) => !(exclude && l.subject.type === exclude.type && l.subject.id === exclude.id),
                );
                hits.push({ query, party: m.party, score: Math.round(m.score * 100) / 100, matchedOn: m.matchedOn, links });
            }
        }
        const id = this.newId();
        prepareCached(
            this.db,
            `INSERT INTO conflict_checks (id, subject_type, subject_id, queries, hits, requested_by, requested_at, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        ).run(id, exclude?.type ?? null, exclude?.id ?? null, JSON.stringify(clean), JSON.stringify(hits), requestedBy, this.clock());
        return this.getCheck(id)!;
    }

    getCheck(id: string): ConflictCheck | null {
        const row = prepareCached<[string], CheckRow>(this.db, `SELECT * FROM conflict_checks WHERE id = ?`).get(id);
        return row ? toCheck(row) : null;
    }

    /** Record the decision on a pending check. A decided check is final. */
    decide(id: string, decision: Exclude<CheckDecision, 'pending'>, by: string, note: string): ConflictCheck {
        if (!['clear', 'waived', 'declined'].includes(decision)) throw new Error("decision must be 'clear', 'waived' or 'declined'");
        const check = this.getCheck(id);
        if (!check) throw new Error(`No conflict check with id ${id}.`);
        if (check.decision !== 'pending') throw new Error(`This conflict check was already decided (${check.decision}).`);
        if (decision === 'waived' && !note.trim()) throw new Error('a waiver needs a note saying who consented and how');
        prepareCached(
            this.db,
            `UPDATE conflict_checks SET decision = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND decision = 'pending'`,
        ).run(decision, by, this.clock(), note.trim(), id);
        return this.getCheck(id)!;
    }

    /** Attach a check made before its subject existed. */
    attachCheck(id: string, subject: SubjectRef): void {
        prepareCached(
            this.db,
            `UPDATE conflict_checks SET subject_type = ?, subject_id = ? WHERE id = ? AND subject_id IS NULL`,
        ).run(subject.type, subject.id, id);
    }

    /** Checks not yet decided, oldest first; only those one person ran when `requestedBy` is given. */
    pendingChecks(requestedBy?: string): ConflictCheck[] {
        return (
            this.db
                .prepare(
                    `SELECT * FROM conflict_checks WHERE decision = 'pending'${requestedBy ? ' AND lower(requested_by) = lower(?)' : ''} ORDER BY requested_at`,
                )
                .all(...(requestedBy ? [requestedBy] : [])) as CheckRow[]
        ).map(toCheck);
    }

    checksFor(subject: SubjectRef): ConflictCheck[] {
        return prepareCached<[string, string], CheckRow>(
            this.db,
            `SELECT * FROM conflict_checks WHERE subject_type = ? AND subject_id = ? ORDER BY requested_at DESC`,
        )
            .all(subject.type, subject.id)
            .map(toCheck);
    }
}
