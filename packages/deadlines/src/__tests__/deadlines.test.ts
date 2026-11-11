import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { DEADLINES_MIGRATIONS, DeadlineStore, addDays, toIcs } from '../index.js';

const m1 = { type: 'matter', id: 'm1' };
const m2 = { type: 'matter', id: 'm2' };

function setup() {
    const db = openDb({ path: ':memory:', migrations: DEADLINES_MIGRATIONS });
    return new DeadlineStore({ db });
}

describe('DeadlineStore', () => {
    it('validates dates, times and reminders', () => {
        const s = setup();
        const base = { subject: m1, title: 'Defence due', kind: 'filing', createdBy: 'a' };
        expect(() => s.create({ ...base, date: '2026-02-30' })).toThrow(/not a real date/);
        expect(() => s.create({ ...base, date: '12/01/2026' })).toThrow(/YYYY-MM-DD/);
        expect(() => s.create({ ...base, date: '2026-12-01', time: '25:00' })).toThrow(/HH:MM/);
        expect(() => s.create({ ...base, date: '2026-12-01', remindDays: [-1] })).toThrow(/reminder days/);
        expect(s.create({ ...base, date: '2026-12-01', remindDays: [1, 14, 1] }).remindDays).toEqual([14, 1]);
    });

    it('lists upcoming and due reminders across subjects', () => {
        const s = setup();
        const a = s.create({ subject: m1, title: 'Defence due', date: '2026-11-25', kind: 'filing', createdBy: 'a' });
        s.create({ subject: m1, title: 'Hearing', date: '2026-12-20', time: '10:30', kind: 'hearing', createdBy: 'a' });
        const late = s.create({ subject: m2, title: 'Notice period ends', date: '2026-11-10', kind: 'notice', createdBy: 'a' });
        expect(s.upcoming('2026-11-30').map((d) => d.title)).toEqual(['Notice period ends', 'Defence due']);
        expect(s.upcoming('2026-12-31', [m1]).map((d) => d.title)).toEqual(['Defence due', 'Hearing']);
        // 2026-11-18: Defence due in 7 days (reminder), notice overdue.
        expect(s.remindersFor('2026-11-18').map((r) => [r.deadline.title, r.daysLeft])).toEqual([
            ['Notice period ends', -8],
            ['Defence due', 7],
        ]);
        s.setStatus(late.id, 'done', 'b');
        expect(s.remindersFor('2026-11-19').map((r) => r.deadline.id)).toEqual([a.id]);
        expect(s.get(late.id)!.completedBy).toBe('b');
    });

    it('exports open deadlines as iCalendar with alarms', () => {
        const s = setup();
        s.create({ subject: m1, title: 'Defence due, Acme v Widget', date: '2026-11-25', kind: 'filing', createdBy: 'a' });
        s.create({ subject: m1, title: 'Hearing', date: '2026-12-20', time: '10:30', kind: 'hearing', remindDays: [2], createdBy: 'a' });
        const ics = toIcs(s.listFor(m1), { calendarName: 'Acme v Widget', productId: '-//Test//EN' });
        expect(ics).toContain('DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126');
        expect(ics).toContain('SUMMARY:Defence due\\, Acme v Widget');
        expect(ics).toContain('DTSTART:20261220T103000');
        expect(ics).toContain('TRIGGER:-P2D');
        expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    });
});
