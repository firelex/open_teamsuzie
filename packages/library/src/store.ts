import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

/**
 * A knowledge library: spaces (e.g. one per practice group, plus a
 * personal "My drafts" space per person) holding items of host-defined
 * kinds (e.g. 'precedent', 'playbook', 'workflow').
 *
 * Every change makes a new version. A new item, and every edit, is a
 * draft; someone approves a version, and readers are given the approved
 * version (`approvedContent`) even while a newer draft waits for approval.
 * Retired items stay readable in their history but are no longer offered.
 * An item can carry a review-by date so stale know-how comes back to its
 * owner.
 *
 * Who may read, edit or approve is the host's decision (e.g. through
 * @teamsuzie/sharing members on the space); this store records who did what.
 */

export const LIBRARY_MIGRATIONS: Migration[] = [
    {
        name: '20261112_create_library',
        up: `
            CREATE TABLE IF NOT EXISTS library_spaces (
                id             TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                description    TEXT NOT NULL DEFAULT '',
                visibility     TEXT NOT NULL CHECK (visibility IN ('firm', 'members')),
                personal_owner TEXT,
                created_by     TEXT NOT NULL,
                created_at     INTEGER NOT NULL,
                archived_at    INTEGER
            );
            CREATE UNIQUE INDEX IF NOT EXISTS library_spaces_personal ON library_spaces (lower(personal_owner)) WHERE personal_owner IS NOT NULL;

            CREATE TABLE IF NOT EXISTS library_items (
                id               TEXT PRIMARY KEY,
                space_id         TEXT NOT NULL REFERENCES library_spaces(id),
                kind             TEXT NOT NULL,
                status           TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
                version          INTEGER NOT NULL,
                approved_version INTEGER,
                approved_by      TEXT,
                approved_at      INTEGER,
                owner_id         TEXT NOT NULL,
                review_by        TEXT,
                created_by       TEXT NOT NULL,
                created_at       INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS library_items_space ON library_items (space_id, kind);

            CREATE TABLE IF NOT EXISTS library_item_versions (
                item_id    TEXT NOT NULL REFERENCES library_items(id),
                version    INTEGER NOT NULL,
                title      TEXT NOT NULL,
                summary    TEXT NOT NULL,
                body       TEXT NOT NULL,
                file_id    TEXT,
                data       TEXT,
                tags       TEXT NOT NULL,
                changed_by TEXT NOT NULL,
                changed_at INTEGER NOT NULL,
                note       TEXT NOT NULL,
                PRIMARY KEY (item_id, version)
            );
        `,
    },
];

export type SpaceVisibility = 'firm' | 'members';
export type ItemStatus = 'draft' | 'approved' | 'retired';

export interface LibrarySpace {
    id: string;
    name: string;
    description: string;
    /** 'firm': everyone may read its approved items; 'members': only the space's members. */
    visibility: SpaceVisibility;
    /** Set for a person's own "My drafts" space. */
    personalOwner: string | null;
    createdBy: string;
    createdAt: number;
    archivedAt: number | null;
}

/** The content of one version of an item. */
export interface ItemContent {
    title: string;
    summary: string;
    /** Text content: a prompt, practice note, drafting notes. */
    body: string;
    /** A stored file (e.g. a precedent's .docx), by the host's file id. */
    fileId: string | null;
    /** Structured, kind-specific content (e.g. a playbook's positions). */
    data: unknown;
    tags: string[];
}

export interface LibraryItem extends ItemContent {
    id: string;
    spaceId: string;
    kind: string;
    status: ItemStatus;
    /** The latest version; the content above is this version's. */
    version: number;
    /** The version readers are given, or null if never approved. */
    approvedVersion: number | null;
    approvedBy: string | null;
    approvedAt: number | null;
    ownerId: string;
    /** YYYY-MM-DD by which the owner should check the item is still right. */
    reviewBy: string | null;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

export interface ItemVersion extends ItemContent {
    itemId: string;
    version: number;
    changedBy: string;
    changedAt: number;
    note: string;
}

export class LibraryInputError extends Error {
    constructor(
        readonly code: 'invalid' | 'not_found' | 'conflict',
        message: string,
    ) {
        super(message);
        this.name = 'LibraryInputError';
    }
}

interface SpaceRow {
    id: string;
    name: string;
    description: string;
    visibility: SpaceVisibility;
    personal_owner: string | null;
    created_by: string;
    created_at: number;
    archived_at: number | null;
}

interface ItemRow {
    id: string;
    space_id: string;
    kind: string;
    status: ItemStatus;
    version: number;
    approved_version: number | null;
    approved_by: string | null;
    approved_at: number | null;
    owner_id: string;
    review_by: string | null;
    created_by: string;
    created_at: number;
    updated_at: number;
}

interface VersionRow {
    item_id: string;
    version: number;
    title: string;
    summary: string;
    body: string;
    file_id: string | null;
    data: string | null;
    tags: string;
    changed_by: string;
    changed_at: number;
    note: string;
}

const toSpace = (r: SpaceRow): LibrarySpace => ({
    id: r.id,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    personalOwner: r.personal_owner,
    createdBy: r.created_by,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
});

const toContent = (v: VersionRow): ItemContent => ({
    title: v.title,
    summary: v.summary,
    body: v.body,
    fileId: v.file_id,
    data: v.data === null ? null : (JSON.parse(v.data) as unknown),
    tags: JSON.parse(v.tags) as string[],
});

const toVersion = (v: VersionRow): ItemVersion => ({
    ...toContent(v),
    itemId: v.item_id,
    version: v.version,
    changedBy: v.changed_by,
    changedAt: v.changed_at,
    note: v.note,
});

function checkDate(date: string | null | undefined): void {
    if (date == null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LibraryInputError('invalid', `"${date}" is not a date written YYYY-MM-DD`);
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new LibraryInputError('invalid', `${date} is not a real date`);
}

function cleanTags(tags: string[] | undefined): string[] {
    return [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))];
}

export interface CreateItemInput {
    spaceId: string;
    kind: string;
    title: string;
    summary?: string;
    body?: string;
    fileId?: string | null;
    data?: unknown;
    tags?: string[];
    /** Who looks after the item; defaults to its creator. */
    ownerId?: string;
    reviewBy?: string | null;
    createdBy: string;
    note?: string;
}

export type ItemPatch = Partial<ItemContent>;

export interface LibraryStoreOptions {
    db: DatabaseInstance;
    now?: () => number;
    idFactory?: () => string;
}

export class LibraryStore {
    private readonly db: DatabaseInstance;
    private readonly clock: () => number;
    private readonly newId: () => string;

    constructor(opts: LibraryStoreOptions) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => Date.now());
        this.newId = opts.idFactory ?? (() => randomUUID());
    }

    // ---- spaces ----

    createSpace(input: { name: string; description?: string; visibility: SpaceVisibility; createdBy: string; personalOwner?: string }): LibrarySpace {
        const name = input.name.trim();
        if (!name) throw new LibraryInputError('invalid', 'a library space needs a name');
        if (input.visibility !== 'firm' && input.visibility !== 'members') {
            throw new LibraryInputError('invalid', `visibility must be firm or members, not ${String(input.visibility)}`);
        }
        const id = this.newId();
        prepareCached(
            this.db,
            `INSERT INTO library_spaces (id, name, description, visibility, personal_owner, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, name, (input.description ?? '').trim(), input.visibility, input.personalOwner ?? null, input.createdBy, this.clock());
        return this.space(id)!;
    }

    space(id: string): LibrarySpace | null {
        const r = prepareCached<[string], SpaceRow>(this.db, `SELECT * FROM library_spaces WHERE id = ?`).get(id);
        return r ? toSpace(r) : null;
    }

    /** Every space that is not archived, shared spaces by name first, then personal ones. */
    spaces(): LibrarySpace[] {
        return prepareCached<[], SpaceRow>(
            this.db,
            `SELECT * FROM library_spaces WHERE archived_at IS NULL ORDER BY personal_owner IS NOT NULL, name COLLATE NOCASE`,
        )
            .all()
            .map(toSpace);
    }

    /** A person's own "My drafts" space, created on first use. Only they see it. */
    personalSpace(userId: string): LibrarySpace {
        const r = prepareCached<[string], SpaceRow>(this.db, `SELECT * FROM library_spaces WHERE lower(personal_owner) = lower(?)`).get(userId);
        if (r) return toSpace(r);
        return this.createSpace({ name: 'My drafts', visibility: 'members', createdBy: userId, personalOwner: userId.toLowerCase() });
    }

    updateSpace(id: string, patch: { name?: string; description?: string; visibility?: SpaceVisibility }): LibrarySpace {
        const s = this.requireSpace(id);
        if (s.personalOwner && patch.visibility === 'firm') throw new LibraryInputError('invalid', 'a personal space cannot be shared with the whole firm');
        const name = patch.name === undefined ? s.name : patch.name.trim();
        if (!name) throw new LibraryInputError('invalid', 'a library space needs a name');
        const visibility = patch.visibility ?? s.visibility;
        if (visibility !== 'firm' && visibility !== 'members') throw new LibraryInputError('invalid', `visibility must be firm or members`);
        prepareCached(this.db, `UPDATE library_spaces SET name = ?, description = ?, visibility = ? WHERE id = ?`).run(
            name,
            patch.description === undefined ? s.description : patch.description.trim(),
            visibility,
            id,
        );
        return this.space(id)!;
    }

    archiveSpace(id: string): LibrarySpace {
        const s = this.requireSpace(id);
        if (s.personalOwner) throw new LibraryInputError('invalid', 'a personal space cannot be archived');
        prepareCached(this.db, `UPDATE library_spaces SET archived_at = ? WHERE id = ?`).run(this.clock(), id);
        return this.space(id)!;
    }

    private requireSpace(id: string): LibrarySpace {
        const s = this.space(id);
        if (!s) throw new LibraryInputError('not_found', `library space ${id} not found`);
        return s;
    }

    // ---- items ----

    createItem(input: CreateItemInput): LibraryItem {
        const space = this.requireSpace(input.spaceId);
        if (space.archivedAt) throw new LibraryInputError('invalid', `the space "${space.name}" is archived`);
        if (!input.kind.trim()) throw new LibraryInputError('invalid', 'an item needs a kind');
        const title = input.title.trim();
        if (!title) throw new LibraryInputError('invalid', 'an item needs a title');
        checkDate(input.reviewBy);
        const id = this.newId();
        const now = this.clock();
        const tx = this.db.transaction(() => {
            prepareCached(
                this.db,
                `INSERT INTO library_items (id, space_id, kind, status, version, owner_id, review_by, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?)`,
            ).run(id, space.id, input.kind.trim(), (input.ownerId ?? input.createdBy).toLowerCase(), input.reviewBy ?? null, input.createdBy, now, now);
            this.writeVersion(id, 1, {
                title,
                summary: (input.summary ?? '').trim(),
                body: input.body ?? '',
                fileId: input.fileId ?? null,
                data: input.data ?? null,
                tags: cleanTags(input.tags),
            }, input.createdBy, now, input.note ?? 'Created');
        });
        tx();
        return this.item(id)!;
    }

    item(id: string): LibraryItem | null {
        const r = prepareCached<[string], ItemRow>(this.db, `SELECT * FROM library_items WHERE id = ?`).get(id);
        return r ? this.toItem(r) : null;
    }

    /** Items, newest change first. `query` matches the latest version's title, summary, body and tags. */
    items(filter: { spaceIds?: string[]; kind?: string; status?: ItemStatus[]; query?: string } = {}): LibraryItem[] {
        const where: string[] = [];
        const args: unknown[] = [];
        if (filter.spaceIds) {
            if (filter.spaceIds.length === 0) return [];
            where.push(`i.space_id IN (${filter.spaceIds.map(() => '?').join(', ')})`);
            args.push(...filter.spaceIds);
        }
        if (filter.kind) {
            where.push('i.kind = ?');
            args.push(filter.kind);
        }
        if (filter.status) {
            if (filter.status.length === 0) return [];
            where.push(`i.status IN (${filter.status.map(() => '?').join(', ')})`);
            args.push(...filter.status);
        }
        if (filter.query?.trim()) {
            const like = `%${filter.query.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
            where.push(`(lower(v.title) LIKE ? ESCAPE '\\' OR lower(v.summary) LIKE ? ESCAPE '\\' OR lower(v.body) LIKE ? ESCAPE '\\' OR lower(v.tags) LIKE ? ESCAPE '\\')`);
            args.push(like, like, like, like);
        }
        const sql = `SELECT i.* FROM library_items i JOIN library_item_versions v ON v.item_id = i.id AND v.version = i.version
                     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.updated_at DESC`;
        return (this.db.prepare(sql).all(...args) as ItemRow[]).map((r) => this.toItem(r));
    }

    /** A new version from the latest one with `patch` applied; the item becomes a draft again. */
    update(id: string, patch: ItemPatch, by: string, note = ''): LibraryItem {
        const item = this.requireItem(id);
        if (item.status === 'retired') throw new LibraryInputError('conflict', `"${item.title}" is retired; reinstate it before changing it`);
        const next: ItemContent = {
            title: patch.title === undefined ? item.title : patch.title.trim(),
            summary: patch.summary === undefined ? item.summary : patch.summary.trim(),
            body: patch.body === undefined ? item.body : patch.body,
            fileId: patch.fileId === undefined ? item.fileId : patch.fileId,
            data: patch.data === undefined ? item.data : patch.data,
            tags: patch.tags === undefined ? item.tags : cleanTags(patch.tags),
        };
        if (!next.title) throw new LibraryInputError('invalid', 'an item needs a title');
        const now = this.clock();
        const version = item.version + 1;
        const tx = this.db.transaction(() => {
            this.writeVersion(id, version, next, by, now, note || 'Edited');
            prepareCached(this.db, `UPDATE library_items SET version = ?, status = 'draft', updated_at = ? WHERE id = ?`).run(version, now, id);
        });
        tx();
        return this.item(id)!;
    }

    /** Approve the latest version, which readers are then given. `expectVersion` guards against approving something newer than was reviewed. */
    approve(id: string, by: string, expectVersion: number): LibraryItem {
        const item = this.requireItem(id);
        if (item.status === 'retired') throw new LibraryInputError('conflict', `"${item.title}" is retired`);
        if (item.version !== expectVersion) {
            throw new LibraryInputError('conflict', `"${item.title}" is now at version ${item.version}, not the version ${expectVersion} you reviewed; check it again before approving`);
        }
        const now = this.clock();
        prepareCached(
            this.db,
            `UPDATE library_items SET status = 'approved', approved_version = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
        ).run(item.version, by, now, now, id);
        return this.item(id)!;
    }

    /** No longer offered to readers; the history is kept. */
    retire(id: string, by: string): LibraryItem {
        const item = this.requireItem(id);
        if (item.status === 'retired') return item;
        // A version with unchanged content records who retired it and when.
        const now = this.clock();
        const tx = this.db.transaction(() => {
            this.writeVersion(id, item.version + 1, item, by, now, 'Retired');
            prepareCached(this.db, `UPDATE library_items SET status = 'retired', version = ?, updated_at = ? WHERE id = ?`).run(item.version + 1, now, id);
        });
        tx();
        return this.item(id)!;
    }

    /** Back as a draft, to be approved again. */
    reinstate(id: string, by: string): LibraryItem {
        const item = this.requireItem(id);
        if (item.status !== 'retired') throw new LibraryInputError('conflict', `"${item.title}" is not retired`);
        prepareCached(this.db, `UPDATE library_items SET status = 'draft', updated_at = ? WHERE id = ?`).run(this.clock(), id);
        return this.update(id, {}, by, 'Reinstated');
    }

    setOwner(id: string, ownerId: string): LibraryItem {
        this.requireItem(id);
        if (!ownerId.trim()) throw new LibraryInputError('invalid', 'an item needs an owner');
        prepareCached(this.db, `UPDATE library_items SET owner_id = ?, updated_at = ? WHERE id = ?`).run(ownerId.trim().toLowerCase(), this.clock(), id);
        return this.item(id)!;
    }

    setReviewBy(id: string, date: string | null): LibraryItem {
        this.requireItem(id);
        checkDate(date);
        prepareCached(this.db, `UPDATE library_items SET review_by = ?, updated_at = ? WHERE id = ?`).run(date, this.clock(), id);
        return this.item(id)!;
    }

    /** Remove an item that was never approved (e.g. an abandoned draft). Approved items are retired instead. */
    deleteDraft(id: string): void {
        const item = this.requireItem(id);
        if (item.approvedVersion !== null) throw new LibraryInputError('conflict', `"${item.title}" has been approved; retire it instead`);
        const tx = this.db.transaction(() => {
            prepareCached(this.db, `DELETE FROM library_item_versions WHERE item_id = ?`).run(id);
            prepareCached(this.db, `DELETE FROM library_items WHERE id = ?`).run(id);
        });
        tx();
    }

    versions(id: string): ItemVersion[] {
        this.requireItem(id);
        return prepareCached<[string], VersionRow>(this.db, `SELECT * FROM library_item_versions WHERE item_id = ? ORDER BY version DESC`)
            .all(id)
            .map(toVersion);
    }

    version(id: string, version: number): ItemVersion | null {
        const r = prepareCached<[string, number], VersionRow>(this.db, `SELECT * FROM library_item_versions WHERE item_id = ? AND version = ?`).get(id, version);
        return r ? toVersion(r) : null;
    }

    /** What readers are given: the approved version, or null when the item is retired or never approved. */
    approvedContent(id: string): ItemVersion | null {
        const item = this.requireItem(id);
        if (item.status === 'retired' || item.approvedVersion === null) return null;
        return this.version(id, item.approvedVersion);
    }

    /** Approved items whose review-by date is on or before `today`, oldest first. */
    reviewDue(today: string): LibraryItem[] {
        checkDate(today);
        return prepareCached<[string], ItemRow>(
            this.db,
            `SELECT * FROM library_items WHERE status = 'approved' AND review_by IS NOT NULL AND review_by <= ? ORDER BY review_by`,
        )
            .all(today)
            .map((r) => this.toItem(r));
    }

    private requireItem(id: string): LibraryItem {
        const item = this.item(id);
        if (!item) throw new LibraryInputError('not_found', `library item ${id} not found`);
        return item;
    }

    private writeVersion(itemId: string, version: number, c: ItemContent, by: string, at: number, note: string): void {
        prepareCached(
            this.db,
            `INSERT INTO library_item_versions (item_id, version, title, summary, body, file_id, data, tags, changed_by, changed_at, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(itemId, version, c.title, c.summary, c.body, c.fileId, c.data === null || c.data === undefined ? null : JSON.stringify(c.data), JSON.stringify(c.tags), by, at, note);
    }

    private toItem(r: ItemRow): LibraryItem {
        const v = this.version(r.id, r.version);
        if (!v) throw new Error(`library item ${r.id} has no version ${r.version}`);
        return {
            title: v.title,
            summary: v.summary,
            body: v.body,
            fileId: v.fileId,
            data: v.data,
            tags: v.tags,
            id: r.id,
            spaceId: r.space_id,
            kind: r.kind,
            status: r.status,
            version: r.version,
            approvedVersion: r.approved_version,
            approvedBy: r.approved_by,
            approvedAt: r.approved_at,
            ownerId: r.owner_id,
            reviewBy: r.review_by,
            createdBy: r.created_by,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}
