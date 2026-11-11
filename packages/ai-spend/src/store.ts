import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { PriceBook, UnpricedModelError } from './prices.js';

export interface SpendScope {
    type: string;
    id: string;
}

export interface RecordSpendInput {
    actor: string;
    /** What made the call, e.g. 'chat', 'task', 'playbook', 'review'. */
    source: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** What the cost is charged to, e.g. a matter. */
    scope: SpendScope | null;
    /** The piece of work, e.g. a task. */
    ref?: { type: string; id: string } | null;
}

export interface SpendEntry {
    id: string;
    at: number;
    actor: string;
    source: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Null when the model had no price at the time. */
    costMicros: number | null;
    currency: string;
    scopeType: string | null;
    scopeId: string | null;
    refType: string | null;
    refId: string | null;
}

export type BudgetPeriod = 'total' | 'month';

export interface Budget {
    scope: SpendScope;
    amountMicros: number;
    currency: string;
    period: BudgetPeriod;
    /** Share of the budget at which to warn, e.g. 0.8. */
    warnRatio: number;
    setBy: string;
    setAt: number;
}

export interface BudgetStatus {
    budget: Budget | null;
    /** Spend in the budget's period (or all time without a budget), priced entries only. */
    spentMicros: number;
    /** Calls in the period whose model had no price. */
    unpricedCalls: number;
    state: 'none' | 'ok' | 'warning' | 'exceeded';
    /** Start of the period counted, or null for all time. */
    since: number | null;
}

export type SpendGroup = 'actor' | 'model' | 'source' | 'day' | 'scope' | 'ref';

export interface SpendFilter {
    scope?: SpendScope;
    from?: number;
    to?: number;
}

export interface SpendGroupRow {
    key: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    unpricedCalls: number;
}

interface EntryRow {
    id: string;
    at: number;
    actor: string;
    source: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_micros: number | null;
    currency: string;
    scope_type: string | null;
    scope_id: string | null;
    ref_type: string | null;
    ref_id: string | null;
}

interface BudgetRow {
    scope_type: string;
    scope_id: string;
    amount_micros: number;
    currency: string;
    period: BudgetPeriod;
    warn_ratio: number;
    set_by: string;
    set_at: number;
}

const GROUP_SQL: Record<SpendGroup, string> = {
    actor: 'actor',
    model: 'model',
    source: 'source',
    day: "strftime('%Y-%m-%d', at / 1000, 'unixepoch')",
    scope: "coalesce(scope_type || ':' || scope_id, '')",
    ref: "coalesce(ref_type || ':' || ref_id, '')",
};

function toEntry(r: EntryRow): SpendEntry {
    return {
        id: r.id,
        at: r.at,
        actor: r.actor,
        source: r.source,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        costMicros: r.cost_micros,
        currency: r.currency,
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        refType: r.ref_type,
        refId: r.ref_id,
    };
}

function toBudget(r: BudgetRow): Budget {
    return {
        scope: { type: r.scope_type, id: r.scope_id },
        amountMicros: r.amount_micros,
        currency: r.currency,
        period: r.period,
        warnRatio: r.warn_ratio,
        setBy: r.set_by,
        setAt: r.set_at,
    };
}

/** Start of the UTC calendar month containing `now`. */
export function monthStart(now: number): number {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface SpendStoreOptions {
    db: DatabaseInstance;
    prices: PriceBook;
    now?: () => number;
    idFactory?: () => string;
}

/**
 * The AI cost ledger: one entry per model call, priced when recorded and
 * charged to a scope (e.g. a matter). Budgets per scope stop new AI work
 * once spent, and warn before.
 */
export class SpendStore {
    private readonly db: DatabaseInstance;
    readonly prices: PriceBook;
    private readonly clock: () => number;
    private readonly newId: () => string;

    constructor(opts: SpendStoreOptions) {
        this.db = opts.db;
        this.prices = opts.prices;
        this.clock = opts.now ?? (() => Date.now());
        this.newId = opts.idFactory ?? (() => randomUUID());
    }

    /** Record one call. An unpriced model is recorded with no cost, never as free. */
    record(input: RecordSpendInput): SpendEntry {
        const inputTokens = Math.max(0, Math.floor(input.inputTokens));
        const outputTokens = Math.max(0, Math.floor(input.outputTokens));
        const cost = this.prices.has(input.model) ? this.prices.costMicros(input.model, inputTokens, outputTokens) : null;
        const entry: SpendEntry = {
            id: this.newId(),
            at: this.clock(),
            actor: input.actor,
            source: input.source,
            model: input.model,
            inputTokens,
            outputTokens,
            costMicros: cost,
            currency: this.prices.currency,
            scopeType: input.scope?.type ?? null,
            scopeId: input.scope?.id ?? null,
            refType: input.ref?.type ?? null,
            refId: input.ref?.id ?? null,
        };
        prepareCached(
            this.db,
            `INSERT INTO ai_spend (id, at, actor, source, model, input_tokens, output_tokens, cost_micros, currency, scope_type,
               scope_id, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            entry.id,
            entry.at,
            entry.actor,
            entry.source,
            entry.model,
            inputTokens,
            outputTokens,
            cost,
            entry.currency,
            entry.scopeType,
            entry.scopeId,
            entry.refType,
            entry.refId,
        );
        return entry;
    }

    getBudget(scope: SpendScope): Budget | null {
        const row = prepareCached<[string, string], BudgetRow>(
            this.db,
            `SELECT * FROM ai_budgets WHERE scope_type = ? AND scope_id = ?`,
        ).get(scope.type, scope.id);
        return row ? toBudget(row) : null;
    }

    setBudget(scope: SpendScope, input: { amountMicros: number; period: BudgetPeriod; warnRatio: number }, by: string): Budget {
        if (!Number.isInteger(input.amountMicros) || input.amountMicros <= 0) throw new Error('a budget must be more than 0');
        if (input.period !== 'total' && input.period !== 'month') throw new Error("period must be 'total' or 'month'");
        if (!(input.warnRatio > 0 && input.warnRatio < 1)) throw new Error('the warning level must be between 0 and 1, e.g. 0.8');
        prepareCached(
            this.db,
            `INSERT INTO ai_budgets (scope_type, scope_id, amount_micros, currency, period, warn_ratio, set_by, set_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(scope_type, scope_id) DO UPDATE SET amount_micros = excluded.amount_micros, currency = excluded.currency,
               period = excluded.period, warn_ratio = excluded.warn_ratio, set_by = excluded.set_by, set_at = excluded.set_at`,
        ).run(scope.type, scope.id, input.amountMicros, this.prices.currency, input.period, input.warnRatio, by, this.clock());
        return this.getBudget(scope)!;
    }

    removeBudget(scope: SpendScope): boolean {
        return (
            prepareCached(this.db, `DELETE FROM ai_budgets WHERE scope_type = ? AND scope_id = ?`).run(scope.type, scope.id)
                .changes > 0
        );
    }

    status(scope: SpendScope): BudgetStatus {
        const budget = this.getBudget(scope);
        if (budget && budget.currency !== this.prices.currency) {
            throw new Error(
                `The budget for ${scope.type} ${scope.id} is in ${budget.currency} but prices are in ${this.prices.currency}; set it again.`,
            );
        }
        const since = budget?.period === 'month' ? monthStart(this.clock()) : null;
        const row = prepareCached<[string, string, number], { spent: number | null; unpriced: number }>(
            this.db,
            `SELECT sum(cost_micros) AS spent, sum(cost_micros IS NULL) AS unpriced FROM ai_spend
             WHERE scope_type = ? AND scope_id = ? AND at >= ?`,
        ).get(scope.type, scope.id, since ?? 0)!;
        const spentMicros = row.spent ?? 0;
        const state = !budget
            ? 'none'
            : spentMicros >= budget.amountMicros
              ? 'exceeded'
              : spentMicros >= budget.amountMicros * budget.warnRatio
                ? 'warning'
                : 'ok';
        return { budget, spentMicros, unpricedCalls: row.unpriced ?? 0, state, since };
    }

    /**
     * Why new AI work on `model` may not start in `scope`, or null: the
     * budget is spent, or the model has no price so the budget cannot be
     * kept.
     */
    block(scope: SpendScope, model: string): string | null {
        const s = this.status(scope);
        if (!s.budget) return null;
        if (!this.prices.has(model)) return new UnpricedModelError(model).message + ' This matter has an AI budget, so unpriced models are not allowed.';
        if (s.state === 'exceeded') {
            const amount = (s.budget.amountMicros / 1_000_000).toFixed(2);
            return `The AI budget for this ${scope.type} (${amount} ${s.budget.currency}${s.budget.period === 'month' ? ' a month' : ''}) is spent.`;
        }
        return null;
    }

    /** Totals grouped by one dimension, largest cost first. */
    report(filter: SpendFilter, groupBy: SpendGroup): SpendGroupRow[] {
        const { where, params } = this.where(filter);
        const key = GROUP_SQL[groupBy];
        return (
            this.db
                .prepare(
                    `SELECT ${key} AS key, count(*) AS calls, sum(input_tokens) AS inputTokens, sum(output_tokens) AS outputTokens,
                       coalesce(sum(cost_micros), 0) AS costMicros, sum(cost_micros IS NULL) AS unpricedCalls
                     FROM ai_spend ${where} GROUP BY key ORDER BY costMicros DESC, calls DESC`,
                )
                .all(...params) as SpendGroupRow[]
        );
    }

    entries(filter: SpendFilter, limit = 100_000): SpendEntry[] {
        const { where, params } = this.where(filter);
        return (
            this.db.prepare(`SELECT * FROM ai_spend ${where} ORDER BY at ASC, rowid ASC LIMIT ?`).all(...params, limit) as EntryRow[]
        ).map(toEntry);
    }

    private where(filter: SpendFilter): { where: string; params: unknown[] } {
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (filter.scope) {
            clauses.push('scope_type = ? AND scope_id = ?');
            params.push(filter.scope.type, filter.scope.id);
        }
        if (filter.from !== undefined) {
            clauses.push('at >= ?');
            params.push(filter.from);
        }
        if (filter.to !== undefined) {
            clauses.push('at < ?');
            params.push(filter.to);
        }
        return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
    }
}
