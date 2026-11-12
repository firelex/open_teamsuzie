import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { ACTIVITY_MIGRATIONS, ActivityStore } from '../index.js';

function setup() {
    const db = openDb({ path: ':memory:', migrations: ACTIVITY_MIGRATIONS });
    let t = 1000;
    const store = new ActivityStore({ db, now: () => ++t });
    const add = (kind: string, org = 'o1') =>
        store.append({ orgId: org, subject: { type: 'matter', id: 'm1' }, actor: { id: 'a@firm.test', type: 'user' }, kind, summary: kind });
    return { db, store, add };
}

describe('activity hash chain', () => {
    it('chains entries per org and verifies them', () => {
        const { store, add } = setup();
        add('a');
        add('b');
        add('x', 'o2');
        add('c');
        expect(store.verify('o1')).toMatchObject({ ok: true, checked: 3, unchained: 0, firstBreak: null });
        expect(store.verify('o2')).toMatchObject({ ok: true, checked: 1 });
        expect(store.head('o1')!.seq).toBe(3);
    });

    it('detects an edited, a deleted and an inserted entry', () => {
        const { db, store, add } = setup();
        const a = add('a');
        const b = add('b');
        add('c');
        db.prepare(`UPDATE activity_entries SET summary = 'nothing happened' WHERE id = ?`).run(b.id);
        expect(store.verify('o1').firstBreak).toMatchObject({ seq: 2, reason: /content no longer matches/ });

        const fresh = setup();
        fresh.add('a');
        const mid = fresh.add('b');
        fresh.add('c');
        fresh.db.prepare(`DELETE FROM activity_entries WHERE id = ?`).run(mid.id);
        expect(fresh.store.verify('o1').firstBreak).toMatchObject({ seq: 3, reason: /entry 2 is missing/ });

        const third = setup();
        third.add('a');
        third.add('b');
        // Rewrite entry 2 consistently with a fresh hash: it no longer points at entry 1 correctly only if prev changes;
        // here a forged row with a wrong prev_hash is detected.
        third.db.prepare(`UPDATE activity_entries SET prev_hash = ? WHERE seq = 2`).run('f'.repeat(64));
        expect(third.store.verify('o1').firstBreak).toMatchObject({ seq: 2, reason: /does not point at the entry before/ });
        expect(a.id).toBeTruthy();
    });

    it('catches removal of the newest entries against a recorded head', () => {
        const { db, store, add } = setup();
        add('a');
        add('b');
        const head = store.head('o1')!;
        db.prepare(`DELETE FROM activity_entries WHERE seq = 2`).run();
        expect(store.verify('o1').ok).toBe(true); // undetectable without an anchor
        expect(store.verify('o1', head).firstBreak).toMatchObject({ reason: /entries after 1 are missing/ });
    });

    it('seals entries written before chaining', () => {
        const { db, store, add } = setup();
        db.prepare(
            `INSERT INTO activity_entries (id, org_id, subject_type, subject_id, kind, summary, metadata, at) VALUES ('old1', 'o1', 'matter', 'm1', 'legacy', 'legacy', '{}', 1)`,
        ).run();
        expect(store.verify('o1').unchained).toBe(1);
        expect(store.sealUnchained()).toBe(1);
        add('new');
        expect(store.verify('o1')).toMatchObject({ ok: true, checked: 2, unchained: 0 });
    });
});

describe('actorsBetween', () => {
    it('lists who acted in a period', () => {
        const { store } = setup();
        store.append({ orgId: 'o1', subject: { type: 'matter', id: 'm' }, actor: { id: 'b@x', type: 'user' }, kind: 'k', summary: 's', at: 10 });
        store.append({ orgId: 'o1', subject: { type: 'matter', id: 'm' }, actor: { id: 'a@x', type: 'user' }, kind: 'k', summary: 's', at: 20 });
        store.append({ orgId: 'o1', subject: { type: 'matter', id: 'm' }, actor: { id: 'c@x', type: 'user' }, kind: 'k', summary: 's', at: 30 });
        expect(store.actorsBetween('o1', 10, 30)).toEqual(['a@x', 'b@x']);
    });
});
