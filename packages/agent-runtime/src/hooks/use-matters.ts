import { useCallback, useEffect, useState } from 'react';

export interface MatterMetadata {
    matterId: string;
    typeId: string | null;
    customFields: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

export interface Matter {
    id: string;
    name: string;
    description: string | null;
    archivedAt: number | null;
    createdAt: number;
    updatedAt: number;
    /** Present on list items when the matter has a metadata row. */
    metadata?: MatterMetadata;
}

export interface CreateMatterInput {
    name: string;
    description?: string;
    typeId?: string | null;
    customFields?: Record<string, unknown>;
}

export interface UpdateMatterInput {
    name?: string;
    description?: string | null;
}

interface UseMattersResult {
    matters: Matter[];
    loading: boolean;
    error: string | null;
    /** Default false. When true, archived matters are included in the listing. */
    includeArchived: boolean;
    setIncludeArchived: (next: boolean) => void;
    refresh: () => Promise<void>;
    create: (input: CreateMatterInput) => Promise<Matter>;
    update: (id: string, input: UpdateMatterInput) => Promise<Matter>;
    archive: (id: string) => Promise<void>;
    unarchive: (id: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
}

export function useMatters(): UseMattersResult {
    const [matters, setMatters] = useState<Matter[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [includeArchived, setIncludeArchived] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const url = includeArchived
                ? '/api/matters?archived=true'
                : '/api/matters';
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) {
                throw new Error(`Failed to load matters (${response.status})`);
            }
            const data = (await response.json()) as { items: Matter[] };
            setMatters(data.items);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load matters',
            );
        } finally {
            setLoading(false);
        }
    }, [includeArchived]);

    const create = useCallback(
        async (input: CreateMatterInput): Promise<Matter> => {
            const response = await fetch('/api/matters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(input),
            });
            if (!response.ok) {
                const data = (await response.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${response.status})`);
            }
            const data = (await response.json()) as { item: Matter };
            setMatters((current) => [data.item, ...current]);
            return data.item;
        },
        [],
    );

    const update = useCallback(
        async (id: string, input: UpdateMatterInput): Promise<Matter> => {
            const response = await fetch(
                `/api/matters/${encodeURIComponent(id)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(input),
                },
            );
            if (!response.ok) {
                const data = (await response.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${response.status})`);
            }
            const data = (await response.json()) as { item: Matter };
            setMatters((current) =>
                current.map((m) => (m.id === id ? data.item : m)),
            );
            return data.item;
        },
        [],
    );

    const archive = useCallback(
        async (id: string): Promise<void> => {
            const response = await fetch(
                `/api/matters/${encodeURIComponent(id)}/archive`,
                { method: 'POST', credentials: 'include' },
            );
            if (!response.ok) throw new Error(`Failed (${response.status})`);
            const data = (await response.json()) as { item: Matter };
            setMatters((current) =>
                includeArchived
                    ? current.map((m) => (m.id === id ? data.item : m))
                    : current.filter((m) => m.id !== id),
            );
        },
        [includeArchived],
    );

    const unarchive = useCallback(async (id: string): Promise<void> => {
        const response = await fetch(
            `/api/matters/${encodeURIComponent(id)}/unarchive`,
            { method: 'POST', credentials: 'include' },
        );
        if (!response.ok) throw new Error(`Failed (${response.status})`);
        const data = (await response.json()) as { item: Matter };
        setMatters((current) =>
            current.map((m) => (m.id === id ? data.item : m)),
        );
    }, []);

    const remove = useCallback(async (id: string): Promise<void> => {
        const response = await fetch(
            `/api/matters/${encodeURIComponent(id)}`,
            { method: 'DELETE', credentials: 'include' },
        );
        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to delete (${response.status})`);
        }
        setMatters((current) => current.filter((m) => m.id !== id));
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        matters,
        loading,
        error,
        includeArchived,
        setIncludeArchived,
        refresh,
        create,
        update,
        archive,
        unarchive,
        remove,
    };
}
