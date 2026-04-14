import type { ApprovalItem, ListFilter, ProposeInput } from './types.js';

/**
 * Storage abstraction for approval items. The queue does not care whether items
 * live in memory, Postgres, SQLite, DynamoDB, or somewhere else — as long as an
 * implementation of this interface exists.
 *
 * Two implementations are expected:
 *  - `InMemoryApprovalStore` (in this package) — tests, demos, ephemeral deployments.
 *  - A Sequelize / Postgres adapter in whichever app owns the database — production.
 */
export interface ApprovalStore {
    create<T = unknown>(input: ProposeInput<T>): Promise<ApprovalItem<T>>;
    get<T = unknown>(id: string): Promise<ApprovalItem<T> | null>;
    update<T = unknown>(id: string, patch: Partial<ApprovalItem<T>>): Promise<ApprovalItem<T>>;
    list(filter: ListFilter): Promise<ApprovalItem[]>;
}
