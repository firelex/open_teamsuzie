import type { ApprovalItem } from './types.js';

export interface DispatchResult {
    success: boolean;
    /** If success is false, a human-readable reason. */
    error?: string;
}

/**
 * A dispatcher carries out an approved action. The queue maps items to
 * dispatchers by `action_type`: each action type must have exactly one
 * registered dispatcher at dispatch time.
 *
 * Dispatchers are plain async functions — no assumptions about networking,
 * transactions, or retry. If your action needs retries, wrap the dispatcher.
 */
export interface ApprovalDispatcher<T = unknown> {
    readonly action_type: string;
    dispatch(item: ApprovalItem<T>): Promise<DispatchResult>;
}
