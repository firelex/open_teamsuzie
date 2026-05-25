import { useCallback, useEffect, useState } from 'react';
import type { Matter } from './use-matters.js';

export interface MatterDocument {
    id: string;
    workspaceId: string;
    folderId: string | null;
    externalDocId: string;
    name: string;
    mimeType: string | null;
    size: number | null;
    position: number;
    addedAt: number;
}

interface UseMatterResult {
    matter: Matter | null;
    documents: MatterDocument[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    uploadDocument: (
        file: File,
        folderId?: string | null,
    ) => Promise<MatterDocument>;
    removeDocument: (docId: string) => Promise<void>;
}

/**
 * Single-matter detail data: the workspace row plus its flat document
 * list. Folder tree support is intentionally omitted — workspaces
 * already exposes the routes, but the agent-runtime detail page renders
 * a flat documents list to keep the surface small. Hosts that need
 * folders compose their own UI against the existing endpoints.
 */
export function useMatter(matterId: string | undefined): UseMatterResult {
    const [matter, setMatter] = useState<Matter | null>(null);
    const [documents, setDocuments] = useState<MatterDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!matterId) return;
        setLoading(true);
        setError(null);
        try {
            const [matterRes, docsRes] = await Promise.all([
                fetch(`/api/matters/${encodeURIComponent(matterId)}`, {
                    credentials: 'include',
                }),
                fetch(
                    `/api/matters/${encodeURIComponent(matterId)}/documents`,
                    { credentials: 'include' },
                ),
            ]);
            if (!matterRes.ok) {
                throw new Error(
                    `Failed to load matter (${matterRes.status})`,
                );
            }
            const matterData = (await matterRes.json()) as { item: Matter };
            setMatter(matterData.item);
            const docsData = docsRes.ok
                ? ((await docsRes.json()) as { items: MatterDocument[] })
                : { items: [] };
            setDocuments(docsData.items);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load matter',
            );
        } finally {
            setLoading(false);
        }
    }, [matterId]);

    const uploadDocument = useCallback(
        async (
            file: File,
            folderId: string | null = null,
        ): Promise<MatterDocument> => {
            if (!matterId) throw new Error('No matter id');
            const form = new FormData();
            form.append('file', file);
            if (folderId) form.append('folderId', folderId);
            const response = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/documents/upload`,
                { method: 'POST', credentials: 'include', body: form },
            );
            if (!response.ok) {
                const data = (await response.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${response.status})`);
            }
            const data = (await response.json()) as { item: MatterDocument };
            setDocuments((current) => [...current, data.item]);
            return data.item;
        },
        [matterId],
    );

    const removeDocument = useCallback(
        async (docId: string): Promise<void> => {
            if (!matterId) return;
            const response = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/documents/${encodeURIComponent(docId)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!response.ok && response.status !== 404) {
                throw new Error(`Failed (${response.status})`);
            }
            setDocuments((current) =>
                current.filter((d) => d.id !== docId),
            );
        },
        [matterId],
    );

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        matter,
        documents,
        loading,
        error,
        refresh,
        uploadDocument,
        removeDocument,
    };
}
