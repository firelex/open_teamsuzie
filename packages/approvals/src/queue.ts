import type { ApprovalDispatcher } from './dispatcher.js';
import type { ApprovalStore } from './store.js';
import type { ApprovalItem, ApprovalReview, ListFilter, ProposeInput } from './types.js';

export interface ApprovalQueueOptions {
    store: ApprovalStore;
}

export interface ReviewInput<T = unknown> {
    reviewer_id: string;
    verdict: 'approve' | 'reject';
    /** If present and verdict is 'approve', replaces the payload before dispatch. */
    edited_payload?: T;
    reason?: string;
}

export class ApprovalQueueError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'ApprovalQueueError';
    }
}

/**
 * Generic human-in-the-loop approval queue.
 *
 *   propose()  — agent submits a proposed action; status=pending.
 *   review()   — human approves or rejects; status=approved|rejected.
 *   dispatch() — runs the registered dispatcher; status=dispatched|failed.
 *
 * Dispatch is a separate step so callers can defer it (e.g. to a worker) rather
 * than running it synchronously inside the review call.
 */
export class ApprovalQueue {
    private readonly store: ApprovalStore;
    private readonly dispatchers = new Map<string, ApprovalDispatcher>();

    constructor(opts: ApprovalQueueOptions) {
        this.store = opts.store;
    }

    /** Register a dispatcher for a specific action_type. */
    registerDispatcher<T = unknown>(dispatcher: ApprovalDispatcher<T>): void {
        if (this.dispatchers.has(dispatcher.action_type)) {
            throw new ApprovalQueueError(
                `Dispatcher already registered for action_type "${dispatcher.action_type}"`,
                'DISPATCHER_CONFLICT',
            );
        }
        this.dispatchers.set(dispatcher.action_type, dispatcher as ApprovalDispatcher);
    }

    /** Inspect registered dispatchers — useful for admin UIs. */
    listActionTypes(): string[] {
        return Array.from(this.dispatchers.keys());
    }

    async propose<T>(input: ProposeInput<T>): Promise<ApprovalItem<T>> {
        if (!input.subject_id) {
            throw new ApprovalQueueError('subject_id is required', 'INVALID_INPUT');
        }
        if (!input.action_type) {
            throw new ApprovalQueueError('action_type is required', 'INVALID_INPUT');
        }
        return this.store.create<T>(input);
    }

    async get<T = unknown>(id: string): Promise<ApprovalItem<T> | null> {
        return this.store.get<T>(id);
    }

    async list(filter: ListFilter = {}): Promise<ApprovalItem[]> {
        return this.store.list(filter);
    }

    /**
     * Apply a human review decision. Transitions status from 'pending' to
     * either 'approved' or 'rejected'. If the reviewer supplies edited_payload
     * and the verdict is 'approve', the payload is updated before dispatch.
     */
    async review<T = unknown>(id: string, input: ReviewInput<T>): Promise<ApprovalItem<T>> {
        const existing = await this.store.get<T>(id);
        if (!existing) {
            throw new ApprovalQueueError(`Approval item ${id} not found`, 'NOT_FOUND');
        }
        if (existing.status !== 'pending') {
            throw new ApprovalQueueError(
                `Cannot review item in status "${existing.status}" (only pending items can be reviewed)`,
                'INVALID_STATE',
            );
        }

        const review: ApprovalReview<T> = {
            reviewer_id: input.reviewer_id,
            verdict: input.verdict,
            edited_payload: input.edited_payload,
            reason: input.reason,
            reviewed_at: new Date(),
        };

        const patch: Partial<ApprovalItem<T>> = {
            status: input.verdict === 'approve' ? 'approved' : 'rejected',
            review,
        };

        if (input.verdict === 'approve' && input.edited_payload !== undefined) {
            patch.payload = input.edited_payload;
        }

        return this.store.update<T>(id, patch);
    }

    /**
     * Run the registered dispatcher for an approved item. Transitions status to
     * 'dispatched' on success or 'failed' on failure. Can only be called on
     * items in 'approved' status.
     */
    async dispatch<T = unknown>(id: string): Promise<ApprovalItem<T>> {
        const existing = await this.store.get<T>(id);
        if (!existing) {
            throw new ApprovalQueueError(`Approval item ${id} not found`, 'NOT_FOUND');
        }
        if (existing.status !== 'approved') {
            throw new ApprovalQueueError(
                `Cannot dispatch item in status "${existing.status}" (only approved items can be dispatched)`,
                'INVALID_STATE',
            );
        }

        const dispatcher = this.dispatchers.get(existing.action_type) as
            | ApprovalDispatcher<T>
            | undefined;
        if (!dispatcher) {
            throw new ApprovalQueueError(
                `No dispatcher registered for action_type "${existing.action_type}"`,
                'NO_DISPATCHER',
            );
        }

        let result: { success: boolean; error?: string };
        try {
            result = await dispatcher.dispatch(existing);
        } catch (err) {
            result = {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        return this.store.update<T>(id, {
            status: result.success ? 'dispatched' : 'failed',
            dispatch: {
                dispatched_at: new Date(),
                result: result.success ? 'success' : 'failure',
                error: result.error,
            },
        });
    }
}
