import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { ROUTINES_MIGRATIONS, RoutineScheduler, RoutineStore, nextOccurrence } from '../index.js';

const at = (iso: string) => new Date(iso).getTime();

function setup(start: string) {
    let now = at(start);
    const db = openDb({ path: ':memory:', migrations: ROUTINES_MIGRATIONS });
    const store = new RoutineStore<{ title: string }>({ db, now: () => now });
    const active = new Set<string>();
    let fired = 0;
    let failNext = false;
    const scheduler = new RoutineScheduler({
        store,
        now: () => now,
        isActive: (ref) => active.has(ref),
        fire: () => {
            if (failNext) {
                failNext = false;
                throw new Error('creator lost access');
            }
            fired += 1;
            const ref = `task-${fired}`;
            active.add(ref);
            return { ref };
        },
    });
    return {
        store,
        scheduler,
        active,
        setNow: (iso: string) => (now = at(iso)),
        fired: () => fired,
        failNext: () => (failNext = true),
    };
}

const weekdays9 = {
    subjectType: 'matter',
    subjectId: 'm1',
    name: 'Docket check',
    schedule: '0 9 * * 1-5',
    timezone: 'Europe/London',
    payload: { title: 'Check the docket' },
    createdBy: 'partner@firm.test',
};

describe('nextOccurrence', () => {
    it('reads the schedule in its time zone', () => {
        // Friday 13 Nov 2026, 10:00 UTC -> Monday 09:00 London (GMT in November).
        expect(new Date(nextOccurrence('0 9 * * 1-5', 'Europe/London', at('2026-11-13T10:00:00Z'))).toISOString()).toBe(
            '2026-11-16T09:00:00.000Z',
        );
        expect(new Date(nextOccurrence('0 9 * * *', 'America/New_York', at('2026-11-13T10:00:00Z'))).toISOString()).toBe(
            '2026-11-13T14:00:00.000Z',
        );
    });

    it('explains bad schedules and time zones', () => {
        expect(() => nextOccurrence('0 9 * *', 'UTC', 0)).toThrow(/five parts/);
        expect(() => nextOccurrence('0 25 * * *', 'UTC', 0)).toThrow(/not valid/);
        expect(() => nextOccurrence('0 9 * * *', 'Mars/Olympus', 0)).toThrow(/Unknown time zone/);
    });
});

describe('RoutineScheduler', () => {
    it('fires when due, skips while the previous run is active, and records everything', async () => {
        const t = setup('2026-11-16T08:00:00Z');
        const r = t.store.create(weekdays9);
        expect(new Date(r.nextRunAt!).toISOString()).toBe('2026-11-16T09:00:00.000Z');

        expect(await t.scheduler.tick()).toEqual([]);
        t.setNow('2026-11-16T09:00:20Z');
        const [first] = await t.scheduler.tick();
        expect(first).toMatchObject({ status: 'started', ref: 'task-1', trigger: 'schedule' });
        expect(new Date(t.store.get(r.id)!.nextRunAt!).toISOString()).toBe('2026-11-17T09:00:00.000Z');

        t.setNow('2026-11-17T09:00:10Z');
        const [second] = await t.scheduler.tick();
        expect(second).toMatchObject({ status: 'skipped', detail: /still in progress/ });

        t.active.clear();
        expect(await t.scheduler.runNow(r.id, 'manual', 'partner@firm.test')).toMatchObject({
            status: 'started',
            actor: 'partner@firm.test',
        });
        expect(t.store.runs(r.id).map((x) => x.status)).toEqual(['started', 'skipped', 'started']);
    });

    it('records a missed run once after downtime, or runs once when asked to catch up', async () => {
        const t = setup('2026-11-16T08:00:00Z');
        const skip = t.store.create(weekdays9);
        const catchUp = t.store.create({ ...weekdays9, name: 'Digest', catchUp: 'run_once' });
        t.setNow('2026-11-19T12:00:00Z'); // three days later
        const runs = await t.scheduler.tick();
        expect(runs.find((x) => x.routineId === skip.id)).toMatchObject({ status: 'skipped', detail: /Missed/ });
        expect(runs.find((x) => x.routineId === catchUp.id)).toMatchObject({ status: 'started' });
        expect(new Date(t.store.get(skip.id)!.nextRunAt!).toISOString()).toBe('2026-11-20T09:00:00.000Z');
        expect(await t.scheduler.tick()).toEqual([]);
    });

    it('records a failed run and moves on', async () => {
        const t = setup('2026-11-16T09:00:00Z');
        const r = t.store.create({ ...weekdays9, schedule: '* * * * *' });
        t.setNow('2026-11-16T09:01:00Z');
        t.failNext();
        expect(await t.scheduler.tick()).toMatchObject([{ status: 'failed', detail: 'creator lost access' }]);
        t.setNow('2026-11-16T09:02:00Z');
        expect(await t.scheduler.tick()).toMatchObject([{ status: 'started' }]);
        expect(t.store.get(r.id)!.lastRunAt).toBe(at('2026-11-16T09:02:00Z'));
    });

    it('does not run disabled routines, and recomputes the next run when re-enabled', async () => {
        const t = setup('2026-11-16T08:00:00Z');
        const r = t.store.create(weekdays9);
        expect(t.store.update(r.id, { enabled: false }).nextRunAt).toBeNull();
        t.setNow('2026-11-18T10:00:00Z');
        expect(await t.scheduler.tick()).toEqual([]);
        expect(new Date(t.store.update(r.id, { enabled: true }).nextRunAt!).toISOString()).toBe('2026-11-19T09:00:00.000Z');
    });
});

describe('webhook tokens', () => {
    it('keeps only a hash and checks tokens', () => {
        const t = setup('2026-11-16T08:00:00Z');
        const r = t.store.create(weekdays9);
        expect(t.store.verifyWebhookToken(r.id, 'anything')).toBe(false);
        const token = t.store.rotateWebhookToken(r.id);
        expect(t.store.get(r.id)!.hasWebhook).toBe(true);
        expect(t.store.verifyWebhookToken(r.id, token)).toBe(true);
        expect(t.store.verifyWebhookToken(r.id, `${token}x`)).toBe(false);
        t.store.rotateWebhookToken(r.id);
        expect(t.store.verifyWebhookToken(r.id, token)).toBe(false);
    });
});
