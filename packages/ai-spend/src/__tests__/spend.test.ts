import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { AI_SPEND_MIGRATIONS, PriceBook, SpendStore, toMicros } from '../index.js';

const matter = { type: 'matter', id: 'm1' };

function setup(start = '2026-11-11T12:00:00Z') {
    let now = new Date(start).getTime();
    const db = openDb({ path: ':memory:', migrations: AI_SPEND_MIGRATIONS });
    const prices = PriceBook.parse('USD', JSON.stringify({ big: { inputPerMillion: 2, outputPerMillion: 8 } }));
    const store = new SpendStore({ db, prices, now: () => now });
    return { store, setNow: (iso: string) => (now = new Date(iso).getTime()) };
}

const call = (model: string, inputTokens: number, outputTokens: number, source = 'chat') => ({
    actor: 'a@firm.test',
    source,
    model,
    inputTokens,
    outputTokens,
    scope: matter,
});

describe('PriceBook', () => {
    it('prices calls exactly in micro-units and rejects bad input', () => {
        const p = new PriceBook('EUR', { m: { inputPerMillion: 0.5, outputPerMillion: 1.5 } });
        expect(p.costMicros('m', 1_000_000, 2_000_000)).toBe(toMicros(3.5));
        expect(() => p.costMicros('other', 1, 1)).toThrow(/No price is configured for the model other/);
        expect(() => PriceBook.parse('USD', '{bad')).toThrow(/not valid JSON/);
        expect(() => new PriceBook('usd', {})).toThrow(/three-letter/);
        expect(() => new PriceBook('USD', { m: { inputPerMillion: -1, outputPerMillion: 1 } })).toThrow(/at least 0/);
    });
});

describe('SpendStore', () => {
    it('records priced and unpriced calls and reports them', () => {
        const { store } = setup();
        store.record(call('big', 100_000, 10_000));
        store.record(call('big', 50_000, 0, 'task'));
        const unpriced = store.record(call('mystery', 1000, 1000));
        expect(unpriced.costMicros).toBeNull();
        expect(store.report({ scope: matter }, 'model')).toEqual([
            { key: 'big', calls: 2, inputTokens: 150_000, outputTokens: 10_000, costMicros: toMicros(0.38), unpricedCalls: 0 },
            { key: 'mystery', calls: 1, inputTokens: 1000, outputTokens: 1000, costMicros: 0, unpricedCalls: 1 },
        ]);
        expect(store.report({}, 'source').map((r) => r.key)).toEqual(['chat', 'task']);
        expect(store.entries({ scope: matter })).toHaveLength(3);
    });

    it('warns, then blocks when a budget is spent, and refuses unpriced models on budgeted scopes', () => {
        const { store } = setup();
        expect(store.status(matter).state).toBe('none');
        expect(store.block(matter, 'mystery')).toBeNull();
        store.setBudget(matter, { amountMicros: toMicros(1), period: 'total', warnRatio: 0.8 }, 'partner@firm.test');
        expect(store.block(matter, 'mystery')).toMatch(/unpriced models are not allowed/);
        store.record(call('big', 400_000, 0)); // 0.80
        expect(store.status(matter)).toMatchObject({ state: 'warning', spentMicros: toMicros(0.8) });
        expect(store.block(matter, 'big')).toBeNull();
        store.record(call('big', 100_000, 0)); // 1.00
        expect(store.status(matter).state).toBe('exceeded');
        expect(store.block(matter, 'big')).toMatch(/AI budget for this matter \(1\.00 USD\) is spent/);
        expect(store.removeBudget(matter)).toBe(true);
        expect(store.block(matter, 'big')).toBeNull();
    });

    it('counts only the current month for a monthly budget', () => {
        const { store, setNow } = setup('2026-10-30T12:00:00Z');
        store.record(call('big', 500_000, 0)); // 1.00 in October
        setNow('2026-11-02T09:00:00Z');
        store.setBudget(matter, { amountMicros: toMicros(1), period: 'month', warnRatio: 0.8 }, 'p');
        expect(store.status(matter)).toMatchObject({ state: 'ok', spentMicros: 0, since: Date.UTC(2026, 10, 1) });
    });

    it('validates budgets', () => {
        const { store } = setup();
        expect(() => store.setBudget(matter, { amountMicros: 0, period: 'total', warnRatio: 0.8 }, 'p')).toThrow(/more than 0/);
        expect(() => store.setBudget(matter, { amountMicros: 5, period: 'year' as never, warnRatio: 0.8 }, 'p')).toThrow(/period/);
        expect(() => store.setBudget(matter, { amountMicros: 5, period: 'total', warnRatio: 1 }, 'p')).toThrow(/between 0 and 1/);
    });
});
