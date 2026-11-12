import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { TIMEKEEPING_MIGRATIONS, TimeStore, amountFor, roundToUnit } from '../index.js';

function setup() {
    let now = Date.UTC(2026, 10, 12, 9, 0);
    const db = openDb({ path: ':memory:', migrations: TIMEKEEPING_MIGRATIONS });
    const store = new TimeStore({ db, currency: 'GBP', unitMinutes: 6, now: () => now });
    return { store, advance: (ms: number) => (now += ms) };
}

const entry = (over: Partial<Parameters<TimeStore['record']>[0]> = {}) => ({
    matterId: 'm1',
    clientId: 'c1',
    personId: 'jane@firm.test',
    date: '2026-11-12',
    rawMinutes: 20,
    narrative: 'Reviewing side letter',
    billable: true,
    source: 'manual',
    createdBy: 'jane@firm.test',
    ...over,
});

describe('rounding and amounts', () => {
    it('rounds up to whole units and prices in minor units', () => {
        expect(roundToUnit(1, 6)).toBe(6);
        expect(roundToUnit(6, 6)).toBe(6);
        expect(roundToUnit(7, 6)).toBe(12);
        expect(amountFor(24, 35000)).toBe(14000); // 0.4h at £350
        expect(amountFor(6, 33333)).toBe(3333); // half up
    });
});

describe('rates', () => {
    it('uses the most specific rate and fixes it on the entry', () => {
        const { store } = setup();
        expect(() => store.record(entry())).toThrow(/No hourly rate is set/);
        store.setRate({ level: 'person', levelId: 'jane@firm.test', hourlyMinor: 30000, setBy: 'admin' });
        expect(store.record(entry()).rateSource).toBe('standard rate of jane@firm.test');
        store.setRate({ level: 'client', levelId: 'c1', hourlyMinor: 28000, setBy: 'admin' });
        store.setRate({ level: 'matter', levelId: 'm1', personId: 'jane@firm.test', hourlyMinor: 25000, setBy: 'admin' });
        const e = store.record(entry());
        expect(e).toMatchObject({ minutes: 24, rateMinor: 25000, amountMinor: 10000, rateSource: 'matter rate for jane@firm.test' });
        // Changing the rate later does not change recorded work.
        store.setRate({ level: 'matter', levelId: 'm1', personId: 'jane@firm.test', hourlyMinor: 40000, setBy: 'admin' });
        expect(store.get(e.id)!.amountMinor).toBe(10000);
        expect(store.rates({ level: 'matter' })).toHaveLength(1);
        expect(store.record(entry({ clientId: null, matterId: 'm2' })).rateMinor).toBe(30000);
    });

    it('records non-billable time without a rate', () => {
        const { store } = setup();
        expect(store.record(entry({ billable: false }))).toMatchObject({ amountMinor: 0, rateSource: 'no rate (not billable)' });
    });
});

describe('entries', () => {
    it('edits, writes off and bills, and protects billed time', () => {
        const { store } = setup();
        store.setRate({ level: 'person', levelId: 'jane@firm.test', hourlyMinor: 30000, setBy: 'admin' });
        const a = store.record(entry());
        const b = store.record(entry({ rawMinutes: 60 }));
        expect(store.update(a.id, { rawMinutes: 31 })).toMatchObject({ minutes: 36, amountMinor: 18000 });
        expect(store.wip()).toEqual([{ matterId: 'm1', minutes: 96, amountMinor: 48000, entries: 2 }]);
        expect(() => store.writeOff(b.id, ' ')).toThrow(/say why/);
        store.writeOff(b.id, 'Duplicated research');
        expect(store.wip()[0].entries).toBe(1);
        store.reinstate(b.id);
        store.markBilled([a.id], 'inv1');
        expect(() => store.update(a.id, { narrative: 'x' })).toThrow(/billed, so it cannot be changed/);
        expect(() => store.delete(a.id)).toThrow(/cannot be deleted/);
        expect(() => store.markBilled([a.id, b.id], 'inv2')).toThrow(/not unbilled/);
        expect(store.get(b.id)!.status).toBe('unbilled'); // all or none
        expect(store.releaseInvoice('inv1')).toBe(1);
        expect(store.get(a.id)!.status).toBe('unbilled');
    });

    it('validates input', () => {
        const { store } = setup();
        expect(() => store.record(entry({ billable: false, date: '2026-13-01' }))).toThrow(/YYYY-MM-DD/);
        expect(() => store.record(entry({ billable: false, rawMinutes: 0 }))).toThrow(/whole number of minutes/);
        expect(() => store.record(entry({ billable: false, narrative: ' ' }))).toThrow(/say what/);
    });
});

describe('timers', () => {
    it('runs one timer per person', () => {
        const { store, advance } = setup();
        store.startTimer('jane@firm.test', 'm1', 'Call with client');
        expect(() => store.startTimer('jane@firm.test', 'm2', 'x')).toThrow(/already running/);
        advance(17 * 60_000 + 20_000);
        expect(store.stopTimer('JANE@firm.test')).toMatchObject({ matterId: 'm1', elapsedMinutes: 17 });
        expect(store.timer('jane@firm.test')).toBeNull();
        expect(() => store.stopTimer('jane@firm.test')).toThrow(/No timer/);
    });
});
