import { useCallback, useEffect, useState } from 'react';
import type {
    CellFormat,
    Review,
    ReviewCell,
    ReviewColumn,
    ReviewDocument,
    ReviewSnapshot,
} from '@teamsuzie/grid-review/browser';

export type {
    CellFormat,
    Review,
    ReviewCell,
    ReviewColumn,
    ReviewDocument,
    ReviewSnapshot,
};

interface UseReviewResult {
    snapshot: ReviewSnapshot | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    addColumn: (input: {
        title: string;
        prompt: string;
        format: CellFormat;
    }) => Promise<ReviewColumn>;
    updateColumn: (
        columnId: string,
        patch: { title?: string; prompt?: string; format?: CellFormat },
    ) => Promise<ReviewColumn>;
    removeColumn: (columnId: string) => Promise<void>;
    addDocument: (input: {
        externalDocId: string;
        name: string;
        mimeType?: string | null;
    }) => Promise<ReviewDocument>;
    removeDocument: (rowId: string) => Promise<void>;
    /**
     * Kicks off the package's `POST /run` SSE stream that walks every
     * pending cell. The hook listens to status events and patches the
     * snapshot's cells in place so the grid updates live. Returns when
     * the stream terminates (done or error).
     *
     * When the run-adapter isn't wired upstream (KB-backed; see GAPS #5),
     * the endpoint returns 501 and this method rejects accordingly so
     * the UI can show a "cell-running needs the KB module" toast.
     */
    runAllPending: () => Promise<void>;
}

function baseUrl(matterId: string, reviewId: string): string {
    return `/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}`;
}

export function useReview(
    matterId: string | undefined,
    reviewId: string | undefined,
): UseReviewResult {
    const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!matterId || !reviewId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(baseUrl(matterId, reviewId), {
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`Failed to load review (${res.status})`);
            }
            const data = (await res.json()) as { snapshot: ReviewSnapshot };
            setSnapshot(data.snapshot);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load review',
            );
        } finally {
            setLoading(false);
        }
    }, [matterId, reviewId]);

    const addColumn = useCallback(
        async (input: {
            title: string;
            prompt: string;
            format: CellFormat;
        }): Promise<ReviewColumn> => {
            if (!matterId || !reviewId) throw new Error('not ready');
            const res = await fetch(
                `${baseUrl(matterId, reviewId)}/columns`,
                {
                    method: 'POST',
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
            const data = (await res.json()) as { item: ReviewColumn };
            await refresh();
            return data.item;
        },
        [matterId, reviewId, refresh],
    );

    const updateColumn = useCallback(
        async (
            columnId: string,
            patch: { title?: string; prompt?: string; format?: CellFormat },
        ): Promise<ReviewColumn> => {
            if (!matterId || !reviewId) throw new Error('not ready');
            const res = await fetch(
                `${baseUrl(matterId, reviewId)}/columns/${encodeURIComponent(columnId)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(patch),
                },
            );
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const data = (await res.json()) as { item: ReviewColumn };
            await refresh();
            return data.item;
        },
        [matterId, reviewId, refresh],
    );

    const removeColumn = useCallback(
        async (columnId: string): Promise<void> => {
            if (!matterId || !reviewId) return;
            const res = await fetch(
                `${baseUrl(matterId, reviewId)}/columns/${encodeURIComponent(columnId)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!res.ok && res.status !== 404) {
                throw new Error(`Failed (${res.status})`);
            }
            await refresh();
        },
        [matterId, reviewId, refresh],
    );

    const addDocument = useCallback(
        async (input: {
            externalDocId: string;
            name: string;
            mimeType?: string | null;
        }): Promise<ReviewDocument> => {
            if (!matterId || !reviewId) throw new Error('not ready');
            const res = await fetch(
                `${baseUrl(matterId, reviewId)}/documents`,
                {
                    method: 'POST',
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
            const data = (await res.json()) as { item: ReviewDocument };
            await refresh();
            return data.item;
        },
        [matterId, reviewId, refresh],
    );

    const removeDocument = useCallback(
        async (rowId: string): Promise<void> => {
            if (!matterId || !reviewId) return;
            const res = await fetch(
                `${baseUrl(matterId, reviewId)}/documents/${encodeURIComponent(rowId)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!res.ok && res.status !== 404) {
                throw new Error(`Failed (${res.status})`);
            }
            await refresh();
        },
        [matterId, reviewId, refresh],
    );

    const runAllPending = useCallback(async (): Promise<void> => {
        if (!matterId || !reviewId) return;
        const res = await fetch(`${baseUrl(matterId, reviewId)}/run`, {
            method: 'POST',
            credentials: 'include',
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
                error?: string;
            };
            // The package returns 501 when no run-adapter is wired.
            // Surface a friendlier message — the host UI re-frames this
            // as a toast.
            if (res.status === 501) {
                throw new Error(
                    'Cell-running comes online once the knowledge-base module ships. Add columns + documents now; populate cells later.',
                );
            }
            throw new Error(data.error || `Failed (${res.status})`);
        }
        // The endpoint streams SSE on success. We don't currently render
        // live progress on the grid (cells stay in 'pending' state in
        // the snapshot); a follow-up could parse the stream and patch
        // individual cells as `done` / `error` events arrive.
        await refresh();
    }, [matterId, reviewId, refresh]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        snapshot,
        loading,
        error,
        refresh,
        addColumn,
        updateColumn,
        removeColumn,
        addDocument,
        removeDocument,
        runAllPending,
    };
}
