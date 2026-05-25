import { useCallback, useEffect, useState } from 'react';

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface Member {
    id: string;
    subjectType: string;
    subjectId: string;
    userId: string;
    role: MemberRole;
    grantedAt: number;
    grantedBy: string | null;
}

export type MemberSubject = { type: 'matter'; id: string };

interface UseMembersResult {
    members: Member[];
    /** Role the session user has on this subject. */
    role: MemberRole | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    add: (input: { email: string; role: MemberRole }) => Promise<void>;
    remove: (userId: string) => Promise<void>;
}

function endpointFor(subject: MemberSubject): string {
    return `/api/matters/${encodeURIComponent(subject.id)}/members`;
}

/**
 * CRUD over `members` rows for one matter subject. The list endpoint
 * returns the session user's role alongside the items so the share
 * dialog can gate "add member" / "remove" affordances.
 */
export function useMembers(
    subject: MemberSubject | null,
    enabled = true,
): UseMembersResult {
    const [members, setMembers] = useState<Member[]>([]);
    const [role, setRole] = useState<MemberRole | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!subject || !enabled) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(endpointFor(subject), {
                credentials: 'include',
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const data = (await res.json()) as {
                items: Member[];
                role: MemberRole;
            };
            setMembers(data.items);
            setRole(data.role);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load members',
            );
        } finally {
            setLoading(false);
        }
    }, [subject, enabled]);

    const add = useCallback(
        async (input: { email: string; role: MemberRole }) => {
            if (!subject) throw new Error('no subject');
            const res = await fetch(endpointFor(subject), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(input),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const data = (await res.json()) as { item: Member };
            setMembers((current) => {
                const existing = current.findIndex(
                    (m) => m.userId === data.item.userId,
                );
                if (existing >= 0) {
                    const next = current.slice();
                    next[existing] = data.item;
                    return next;
                }
                return [...current, data.item];
            });
        },
        [subject],
    );

    const remove = useCallback(
        async (userId: string) => {
            if (!subject) throw new Error('no subject');
            const res = await fetch(
                `${endpointFor(subject)}/${encodeURIComponent(userId)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            setMembers((current) =>
                current.filter((m) => m.userId !== userId),
            );
        },
        [subject],
    );

    useEffect(() => {
        if (subject && enabled) void refresh();
        else {
            setMembers([]);
            setRole(null);
        }
    }, [subject, enabled, refresh]);

    return { members, role, loading, error, refresh, add, remove };
}
