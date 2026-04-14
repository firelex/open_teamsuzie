import { randomUUID } from 'node:crypto';
import type { ApprovalStore } from './store.js';
import type { ApprovalItem, ListFilter, ProposeInput } from './types.js';

/**
 * In-process store for tests, demos, and ephemeral deployments. Not durable —
 * all items vanish when the process exits. For production use, implement
 * ApprovalStore against your database of choice.
 */
export class InMemoryApprovalStore implements ApprovalStore {
    private items = new Map<string, ApprovalItem>();

    async create<T = unknown>(input: ProposeInput<T>): Promise<ApprovalItem<T>> {
        const now = new Date();
        const item: ApprovalItem<T> = {
            id: randomUUID(),
            subject_id: input.subject_id,
            action_type: input.action_type,
            payload: input.payload,
            status: 'pending',
            metadata: input.metadata,
            created_at: now,
            updated_at: now,
        };
        this.items.set(item.id, item as ApprovalItem);
        return item;
    }

    async get<T = unknown>(id: string): Promise<ApprovalItem<T> | null> {
        const item = this.items.get(id);
        return (item as ApprovalItem<T> | undefined) ?? null;
    }

    async update<T = unknown>(id: string, patch: Partial<ApprovalItem<T>>): Promise<ApprovalItem<T>> {
        const existing = this.items.get(id);
        if (!existing) throw new Error(`Approval item ${id} not found`);
        const updated: ApprovalItem<T> = {
            ...(existing as ApprovalItem<T>),
            ...patch,
            id: existing.id,
            created_at: existing.created_at,
            updated_at: new Date(),
        };
        this.items.set(id, updated as ApprovalItem);
        return updated;
    }

    async list(filter: ListFilter): Promise<ApprovalItem[]> {
        const wanted = filter.status
            ? new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
            : null;

        let results = Array.from(this.items.values())
            .filter(item => !wanted || wanted.has(item.status))
            .filter(item => !filter.subject_id || item.subject_id === filter.subject_id)
            .filter(item => !filter.action_type || item.action_type === filter.action_type)
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

        if (filter.offset) results = results.slice(filter.offset);
        if (filter.limit !== undefined) results = results.slice(0, filter.limit);

        return results;
    }

    /** Test helper: drop all items. Not part of the ApprovalStore contract. */
    clear(): void {
        this.items.clear();
    }
}
