/**
 * State machine for approval items.
 *
 *   pending ──► approved ──► dispatched
 *         └──► rejected
 *         └──► approved (with edited payload) ──► dispatched
 *
 * Terminal states: rejected, dispatched, failed.
 */
export type ApprovalStatus =
    | 'pending'       // Awaiting human review.
    | 'approved'      // Human approved; awaiting dispatch.
    | 'rejected'      // Human rejected; will not dispatch.
    | 'dispatched'    // Dispatcher ran and succeeded.
    | 'failed';       // Dispatcher ran and failed (see dispatch.error).

export interface ApprovalReview<T = unknown> {
    reviewer_id: string;
    verdict: 'approve' | 'reject';
    /** If present, the approved payload replaces the original before dispatch. */
    edited_payload?: T;
    /** Free-text rationale from the reviewer (optional). */
    reason?: string;
    reviewed_at: Date;
}

export interface ApprovalDispatchRecord {
    dispatched_at: Date;
    result: 'success' | 'failure';
    error?: string;
}

/**
 * A proposed action awaiting human review.
 *
 * `T` is the shape of the action payload. Each `actionType` should map to a single
 * consistent payload type — e.g. `actionType: 'email.send'` → `T = EmailSendPayload`.
 */
export interface ApprovalItem<T = unknown> {
    id: string;
    /** Who proposed this action (usually an agent id). */
    subject_id: string;
    /** Discriminator used to route to a registered dispatcher. */
    action_type: string;
    /** The payload the dispatcher will act on if approved. */
    payload: T;
    status: ApprovalStatus;
    /** Set once a reviewer has decided. */
    review?: ApprovalReview<T>;
    /** Set once the dispatcher has run (whether successfully or not). */
    dispatch?: ApprovalDispatchRecord;
    /** Free-form metadata the caller can attach (e.g. correlation ids, sources). */
    metadata?: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

/**
 * Input for proposing a new item. The queue assigns id / timestamps / status.
 */
export interface ProposeInput<T = unknown> {
    subject_id: string;
    action_type: string;
    payload: T;
    metadata?: Record<string, unknown>;
}

export interface ListFilter {
    status?: ApprovalStatus | ApprovalStatus[];
    subject_id?: string;
    action_type?: string;
    limit?: number;
    offset?: number;
}
