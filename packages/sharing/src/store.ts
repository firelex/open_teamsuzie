import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
    AddMemberInput,
    Member,
    OwnerLookup,
    Role,
    SubjectRef,
} from './types.js';
import { ROLE_RANK, ROLES } from './types.js';

interface MemberRow {
    id: string;
    subject_type: string;
    subject_id: string;
    user_id: string;
    role: string;
    granted_at: number;
    granted_by: string | null;
}

export interface MembersStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

/**
 * CRUD over the `members` table plus a `canAccess` helper that combines
 * explicit grants with implicit owner-from-creation via a host-provided
 * lookup callback.
 */
export class MembersStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: MembersStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    /**
     * Insert or upsert a member row. If a row already exists for
     * (subject_type, subject_id, user_id), its role is updated to the
     * new value and `granted_at` / `granted_by` refresh. The id is
     * stable across upserts.
     */
    addMember(input: AddMemberInput): Member {
        if (!ROLES.includes(input.role)) {
            throw new Error(
                `invalid role: ${input.role} (expected one of: ${ROLES.join(', ')})`,
            );
        }
        const existing = this.findByKey(
            input.subjectType,
            input.subjectId,
            input.userId,
        );
        const now = this.clock();
        if (existing) {
            prepareCached<[string, number, string | null, string]>(
                this.db,
                `UPDATE members SET role = ?, granted_at = ?, granted_by = ? WHERE id = ?`,
            ).run(input.role, now, input.grantedBy ?? null, existing.id);
            return this.getMember(existing.id)!;
        }
        const id = this.newId();
        prepareCached<
            [string, string, string, string, string, number, string | null]
        >(
            this.db,
            `INSERT INTO members (id, subject_type, subject_id, user_id, role, granted_at, granted_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.subjectType,
            input.subjectId,
            input.userId,
            input.role,
            now,
            input.grantedBy ?? null,
        );
        return this.getMember(id)!;
    }

    getMember(id: string): Member | null {
        const row = prepareCached<[string], MemberRow>(
            this.db,
            `SELECT * FROM members WHERE id = ?`,
        ).get(id);
        return row ? rowToMember(row) : null;
    }

    /** Remove a member by (subject, user). Returns true if a row was removed. */
    removeMember(
        subjectType: string,
        subjectId: string,
        userId: string,
    ): boolean {
        const result = prepareCached<[string, string, string]>(
            this.db,
            `DELETE FROM members WHERE subject_type = ? AND subject_id = ? AND user_id = ?`,
        ).run(subjectType, subjectId, userId);
        return result.changes > 0;
    }

    /**
     * Cascade-remove every membership row for a subject. Host calls this
     * when the underlying matter / review / workflow is deleted, since
     * we don't FK across packages.
     */
    removeMembersFor(subject: SubjectRef): number {
        const result = prepareCached<[string, string]>(
            this.db,
            `DELETE FROM members WHERE subject_type = ? AND subject_id = ?`,
        ).run(subject.type, subject.id);
        return result.changes;
    }

    /** Members of a given subject, ordered by role precedence then grant time. */
    listMembersFor(subject: SubjectRef): Member[] {
        return prepareCached<[string, string], MemberRow>(
            this.db,
            `SELECT * FROM members
             WHERE subject_type = ? AND subject_id = ?
             ORDER BY granted_at ASC`,
        )
            .all(subject.type, subject.id)
            .map(rowToMember);
    }

    /**
     * Subjects of a given type that `userId` has explicit membership on.
     * Implicit ownership (from the OwnerLookup) is not included — host
     * code unions this with its own owner-of-X query if they want a
     * complete "things this user can see" set.
     */
    listSubjectsFor(userId: string, subjectType: string): Member[] {
        return prepareCached<[string, string], MemberRow>(
            this.db,
            `SELECT * FROM members
             WHERE user_id = ? AND subject_type = ?
             ORDER BY granted_at DESC`,
        )
            .all(userId, subjectType)
            .map(rowToMember);
    }

    /**
     * Explicit role grant for (subject, user), without consulting any
     * owner lookup. Returns null if the user has no member row.
     */
    getRole(subject: SubjectRef, userId: string): Role | null {
        const row = this.findByKey(subject.type, subject.id, userId);
        return row ? (row.role as Role) : null;
    }

    /**
     * Strongest role the user has on a subject, considering both explicit
     * member rows and the implicit owner from `ownerLookup`. Returns
     * null when the user has no access.
     *
     * Pass `ownerLookup` as either a callback or null/undefined to skip
     * implicit-owner resolution and check only explicit grants.
     */
    async canAccess(
        subject: SubjectRef,
        userId: string,
        ownerLookup?: OwnerLookup | null,
    ): Promise<Role | null> {
        const explicit = this.getRole(subject, userId);
        if (explicit === 'owner') return 'owner';

        let implicit: Role | null = null;
        if (ownerLookup) {
            const ownerId = await ownerLookup(subject);
            if (ownerId && ownerId === userId) implicit = 'owner';
        }

        if (!explicit && !implicit) return null;
        if (!explicit) return implicit;
        if (!implicit) return explicit;
        return ROLE_RANK[explicit] >= ROLE_RANK[implicit] ? explicit : implicit;
    }

    private findByKey(
        subjectType: string,
        subjectId: string,
        userId: string,
    ): MemberRow | null {
        const row = prepareCached<[string, string, string], MemberRow>(
            this.db,
            `SELECT * FROM members
             WHERE subject_type = ? AND subject_id = ? AND user_id = ?`,
        ).get(subjectType, subjectId, userId);
        return row ?? null;
    }
}

function rowToMember(row: MemberRow): Member {
    return {
        id: row.id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        userId: row.user_id,
        role: row.role as Role,
        grantedAt: row.granted_at,
        grantedBy: row.granted_by,
    };
}
