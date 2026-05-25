import { useCallback, useEffect, useState } from 'react';

export interface MatterReview {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface ReviewSnapshot {
    review: MatterReview;
    columns: Array<{
        id: string;
        reviewId: string;
        title: string;
        prompt: string;
        format: string;
        position: number;
    }>;
    documents: Array<{
        id: string;
        reviewId: string;
        externalDocId: string;
        name: string;
        mimeType: string | null;
        position: number;
    }>;
}

interface UseMatterReviewsResult {
    reviews: MatterReview[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    /**
     * Create an empty review (no columns, no documents). Returns the
     * shallow Review row so the host can navigate straight into the
     * grid where columns get built.
     */
    create: (input: {
        name: string;
        description?: string;
    }) => Promise<MatterReview>;
    createFromWorkflow: (input: {
        workflowId: string;
        externalDocIds: string[];
    }) => Promise<ReviewSnapshot>;
    remove: (reviewId: string) => Promise<void>;
}

/**
 * CRUD over the matter-scoped grid reviews surface mounted at
 * `/api/matters/:matterId/reviews`. The detail page renders a flat
 * list + a "New review from workflow" CTA — full cell-running UI
 * (columns picker, doc picker, run progress) is intentionally out of
 * this hook's scope until the KB-backed RunCellAdapter ships and the
 * `/run` endpoint stops returning 501.
 */
export function useMatterReviews(
    matterId: string | undefined,
): UseMatterReviewsResult {
    const [reviews, setReviews] = useState<MatterReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!matterId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/reviews`,
                { credentials: 'include' },
            );
            if (!res.ok) {
                throw new Error(`Failed to load reviews (${res.status})`);
            }
            const data = (await res.json()) as { items: MatterReview[] };
            setReviews(data.items);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Failed to load reviews',
            );
        } finally {
            setLoading(false);
        }
    }, [matterId]);

    const create = useCallback(
        async (input: {
            name: string;
            description?: string;
        }): Promise<MatterReview> => {
            if (!matterId) throw new Error('no matter id');
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/reviews`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        name: input.name,
                        description: input.description ?? null,
                    }),
                },
            );
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const data = (await res.json()) as { item: MatterReview };
            await refresh();
            return data.item;
        },
        [matterId, refresh],
    );

    const createFromWorkflow = useCallback(
        async (input: {
            workflowId: string;
            externalDocIds: string[];
        }): Promise<ReviewSnapshot> => {
            if (!matterId) throw new Error('no matter id');
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/reviews/from-workflow`,
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
            const data = (await res.json()) as {
                item: ReviewSnapshot;
                skipped: number;
            };
            // Refresh the list so the new review shows up — server may
            // sort differently than just prepending locally.
            await refresh();
            return data.item;
        },
        [matterId, refresh],
    );

    const remove = useCallback(
        async (reviewId: string): Promise<void> => {
            if (!matterId) return;
            const res = await fetch(
                `/api/matters/${encodeURIComponent(matterId)}/reviews/${encodeURIComponent(reviewId)}`,
                { method: 'DELETE', credentials: 'include' },
            );
            if (!res.ok && res.status !== 404) {
                throw new Error(`Failed (${res.status})`);
            }
            setReviews((current) => current.filter((r) => r.id !== reviewId));
        },
        [matterId],
    );

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { reviews, loading, error, refresh, create, createFromWorkflow, remove };
}
