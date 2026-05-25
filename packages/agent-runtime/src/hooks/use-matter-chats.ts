import { useCallback, useEffect, useState } from 'react';
import type { Chat } from '@teamsuzie/chats';

export type { Chat };

interface UseMatterChatsResult {
    chats: Chat[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    create: (name?: string) => Promise<Chat>;
    remove: (chatId: string) => Promise<void>;
}

export function useMatterChats(
    matterId: string | undefined,
): UseMatterChatsResult {
    const [chats, setChats] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!matterId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/chats`,
                { credentials: 'include' },
            );
            if (!res.ok) throw new Error(`Failed to load chats (${res.status})`);
            const data = (await res.json()) as { items: Chat[] };
            setChats(data.items);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load chats',
            );
        } finally {
            setLoading(false);
        }
    }, [matterId]);

    const create = useCallback(
        async (name?: string): Promise<Chat> => {
            if (!matterId) throw new Error('No matter id');
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/chats`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(name ? { name } : {}),
                },
            );
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const data = (await res.json()) as { item: Chat };
            setChats((c) => [data.item, ...c]);
            return data.item;
        },
        [matterId],
    );

    const remove = useCallback(
        async (chatId: string): Promise<void> => {
            if (!matterId) return;
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/chats/${encodeURIComponent(chatId)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!res.ok && res.status !== 404) {
                throw new Error(`Failed (${res.status})`);
            }
            setChats((c) => c.filter((x) => x.id !== chatId));
        },
        [matterId],
    );

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { chats, loading, error, refresh, create, remove };
}
