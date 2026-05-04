/**
 * Role assigned to a member. The order also defines precedence — `owner`
 * supersedes `editor` supersedes `viewer`. `canAccess` returns the
 * strongest role found across explicit member rows and the implicit
 * owner-from-creation lookup.
 */
export type Role = 'owner' | 'editor' | 'viewer';

export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'] as const;

/**
 * Strength ordering for role comparison. Higher = stronger. `canAccess`
 * uses this to resolve precedence when a user has multiple grant paths
 * to the same subject (e.g., explicit member row + implicit owner).
 */
export const ROLE_RANK: Record<Role, number> = {
    owner: 3,
    editor: 2,
    viewer: 1,
};

/**
 * Subjects are opaque (type, id) pairs. The store doesn't enforce a
 * fixed enum — host apps register whichever subject types they care
 * about. Conventionally: 'matter', 'review', 'workflow'. Subject IDs
 * are opaque strings; no FK is enforced across packages, matching the
 * loose-coupling pattern used by `chats.workspace_id`,
 * `review_documents.external_doc_id`, and `document_versions.external_doc_id`.
 */
export interface SubjectRef {
    type: string;
    id: string;
}

export interface Member {
    id: string;
    subjectType: string;
    subjectId: string;
    userId: string;
    role: Role;
    grantedAt: number;
    grantedBy: string | null;
}

export interface AddMemberInput {
    subjectType: string;
    subjectId: string;
    userId: string;
    role: Role;
    grantedBy?: string | null;
}

/**
 * Lookup callback the host implements to expose a subject's owner (the
 * implicit role granted by creation). Returning `null` means the subject
 * has no implicit owner — only explicit member rows grant access.
 */
export type OwnerLookup = (
    subject: SubjectRef,
) => string | null | Promise<string | null>;
