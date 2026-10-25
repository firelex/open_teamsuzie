import type { OperationName } from '@teamsuzie/webmail-routes';
import type { DatabaseInstance } from './db.js';

/**
 * Where an operation stands for one account. `suspect`: it failed and a canary is checking it. `relearning`: the
 * learner is repairing it. `broken`: repairs failed; its jobs fail at once until a later relearn succeeds.
 */
export type OpState = 'healthy' | 'suspect' | 'relearning' | 'broken';

export interface OpHealth {
    state: OpState;
    since: string;
    last_error: string | null;
    /** A send route changed and no send has yet been confirmed in Sent. */
    send_unconfirmed: boolean;
    last_relearn_at: string | null;
}

interface Row {
    operation: OperationName;
    state: OpState;
    since: string;
    last_error: string | null;
    send_unconfirmed: number;
    last_relearn_at: string | null;
}

/** Operation health per account, kept in SQLite. An operation never recorded is healthy: nothing has failed yet. */
export class HealthStore {
    constructor(private readonly db: DatabaseInstance, private readonly now: () => Date) {}

    get(account: string, operation: OperationName): OpHealth {
        const row = this.db.prepare<[string, string], Row>('SELECT * FROM op_health WHERE account = ? AND operation = ?').get(account, operation);
        if (!row) return { state: 'healthy', since: new Date(0).toISOString(), last_error: null, send_unconfirmed: false, last_relearn_at: null };
        return toHealth(row);
    }

    set(account: string, operation: OperationName, patch: Partial<OpHealth>): OpHealth {
        const current = this.get(account, operation);
        const next: OpHealth = {
            ...current,
            ...patch,
            since: patch.state !== undefined && patch.state !== current.state ? this.now().toISOString() : current.since,
        };
        this.db.prepare(`
            INSERT INTO op_health (account, operation, state, since, last_error, send_unconfirmed, last_relearn_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (account, operation) DO UPDATE SET
                state = excluded.state, since = excluded.since, last_error = excluded.last_error,
                send_unconfirmed = excluded.send_unconfirmed, last_relearn_at = excluded.last_relearn_at
        `).run(account, operation, next.state, next.since, next.last_error, next.send_unconfirmed ? 1 : 0, next.last_relearn_at);
        return next;
    }

    /** Every recorded operation for the account. */
    all(account: string): Partial<Record<OperationName, OpHealth>> {
        const rows = this.db.prepare<[string], Row>('SELECT * FROM op_health WHERE account = ?').all(account);
        return Object.fromEntries(rows.map((row) => [row.operation, toHealth(row)]));
    }
}

function toHealth(row: Row): OpHealth {
    return {
        state: row.state,
        since: row.since,
        last_error: row.last_error,
        send_unconfirmed: row.send_unconfirmed === 1,
        last_relearn_at: row.last_relearn_at,
    };
}
