import { useCallback, useEffect, useState } from 'react';

export interface MatterMetadata {
    matterId: string;
    typeId: string | null;
    customFields: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

interface UseMatterMetadataResult {
    metadata: MatterMetadata | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    save: (input: {
        typeId: string | null;
        customFields: Record<string, unknown>;
    }) => Promise<MatterMetadata>;
}

export function useMatterMetadata(
    matterId: string | undefined,
): UseMatterMetadataResult {
    const [metadata, setMetadata] = useState<MatterMetadata | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!matterId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/metadata`,
                { credentials: 'include' },
            );
            if (!res.ok) {
                throw new Error(`Failed to load metadata (${res.status})`);
            }
            const data = (await res.json()) as { item: MatterMetadata | null };
            setMetadata(data.item);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Failed to load metadata',
            );
        } finally {
            setLoading(false);
        }
    }, [matterId]);

    const save = useCallback(
        async (input: {
            typeId: string | null;
            customFields: Record<string, unknown>;
        }): Promise<MatterMetadata> => {
            if (!matterId) throw new Error('no matter id');
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/metadata`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(input),
                },
            );
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const data = (await res.json()) as { item: MatterMetadata };
            setMetadata(data.item);
            return data.item;
        },
        [matterId],
    );

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { metadata, loading, error, refresh, save };
}
