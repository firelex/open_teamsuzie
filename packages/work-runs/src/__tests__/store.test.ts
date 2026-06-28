import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryStorage, JsonFileStorage } from '../storage.js';
import { WorkRunError, WorkRunsStore } from '../store.js';

function makeStore() {
    const storage = new InMemoryStorage();
    let n = 0;
    const store = new WorkRunsStore({
        storage,
        idFactory: () => `run-${++n}`,
        // Monotonic ISO timestamps so list ordering is deterministic.
        now: (() => {
            let t = Date.parse('2026-06-06T00:00:00.000Z');
            return () => new Date((t += 1000)).toISOString();
        })(),
    });
    return { storage, store };
}

describe('WorkRunsStore — basic state', () => {
    it('create() supersedes existing live runs', () => {
        const { store } = makeStore();
        const a = store.create({ subjectId: 's1', mode: 'ready_queue' });
        const b = store.create({ subjectId: 's1', mode: 'single_ticket' });
        const all = store.list();
        expect(all.map((r) => r.id)).toEqual([b.id, a.id]);
        expect(all.find((r) => r.id === a.id)!.status).toBe('completed');
        expect(all.find((r) => r.id === a.id)!.endedAt).not.toBeNull();
        expect(all.find((r) => r.id === b.id)!.status).toBe('running');
    });

    it('current() returns the first live run, ignoring terminal ones', () => {
        const { store } = makeStore();
        const a = store.create({ subjectId: 's1', mode: 'ready_queue' });
        store.update(a.id, { status: 'completed', endedAt: '2026-06-06T01:00:00Z' });
        expect(store.current()).toBeNull();
        const b = store.create({ subjectId: 's1', mode: 'ready_queue' });
        expect(store.current()?.id).toBe(b.id);
    });

    it('update() patches a run in place', () => {
        const { store } = makeStore();
        const run = store.create({ subjectId: 's1', mode: 'ready_queue' });
        const updated = store.update(run.id, { notes: 'hello' });
        expect(updated?.notes).toBe('hello');
        expect(store.get(run.id)?.notes).toBe('hello');
    });

    it('markInterruptedFailed() sweeps running and blocked, preserves paused and terminals', () => {
        // Build a heterogeneous set manually rather than via create() — which
        // would supersede live runs and force every prior one to completed.
        const { storage, store } = makeStore();
        storage.writeAll([
            { id: 'r-completed', subjectId: 's', status: 'completed', mode: 'm', scope: '', startedAt: '2026-06-06T00:00:01Z', endedAt: '2026-06-06T00:01:00Z', startedBy: 'u', activeItemId: null, completedItemIds: [], blockedItemIds: [], createdItemIds: [], notes: '' },
            { id: 'r-running', subjectId: 's', status: 'running', mode: 'm', scope: '', startedAt: '2026-06-06T00:00:02Z', endedAt: null, startedBy: 'u', activeItemId: null, completedItemIds: [], blockedItemIds: [], createdItemIds: [], notes: 'in flight' },
            { id: 'r-paused', subjectId: 's', status: 'paused', mode: 'm', scope: '', startedAt: '2026-06-06T00:00:03Z', endedAt: null, startedBy: 'u', activeItemId: null, completedItemIds: [], blockedItemIds: [], createdItemIds: [], notes: '' },
            { id: 'r-blocked', subjectId: 's', status: 'blocked', mode: 'm', scope: '', startedAt: '2026-06-06T00:00:04Z', endedAt: null, startedBy: 'u', activeItemId: 'i1', completedItemIds: [], blockedItemIds: ['i1'], createdItemIds: [], notes: '' },
        ]);
        const changed = store.markInterruptedFailed();
        expect(changed).toBe(2);
        expect(store.get('r-completed')?.status).toBe('completed');
        expect(store.get('r-paused')?.status).toBe('paused');
        expect(store.get('r-running')?.status).toBe('failed');
        expect(store.get('r-running')?.notes).toContain('interrupted by server restart');
        expect(store.get('r-blocked')?.status).toBe('failed');
    });
});

describe('WorkRunsStore — recoverInterrupted', () => {
    it('returns existing live run unchanged', () => {
        const { store } = makeStore();
        const live = store.create({ subjectId: 's', mode: 'ready_queue' });
        const recovered = store.recoverInterrupted();
        expect(recovered?.id).toBe(live.id);
        expect(recovered?.status).toBe('running');
    });

    it('flips a failed run with an active item back to running', () => {
        const { store } = makeStore();
        const run = store.create({
            subjectId: 's',
            mode: 'ready_queue',
            activeItemId: 'i1',
        });
        store.update(run.id, { status: 'failed', endedAt: '2026-06-06T02:00:00Z' });

        const recovered = store.recoverInterrupted({ reason: 'human said so' });
        expect(recovered?.id).toBe(run.id);
        expect(recovered?.status).toBe('running');
        expect(recovered?.endedAt).toBeNull();
        expect(recovered?.notes).toContain('human said so');
    });

    it('skips runs the host predicate rejects', () => {
        const { store } = makeStore();
        const run = store.create({
            subjectId: 's',
            mode: 'ready_queue',
            activeItemId: 'i1',
        });
        store.update(run.id, { status: 'failed' });
        const recovered = store.recoverInterrupted({ predicate: () => false });
        expect(recovered).toBeNull();
        expect(store.get(run.id)?.status).toBe('failed');
    });

    it('returns null when no live run and no failed candidate', () => {
        const { store } = makeStore();
        expect(store.recoverInterrupted()).toBeNull();
    });
});

describe('WorkRunsStore — claimItem', () => {
    it('sets activeItemId on a running run', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue' });
        const claimed = store.claimItem('item-1', { replaceActive: false });
        expect(claimed.activeItemId).toBe('item-1');
    });

    it('rejects claim when there is no running run', () => {
        const { store } = makeStore();
        expect(() => store.claimItem('item-1')).toThrow(WorkRunError);
    });

    it('rejects claim when run is paused', () => {
        const { store } = makeStore();
        const r = store.create({ subjectId: 's', mode: 'ready_queue' });
        store.update(r.id, { status: 'paused' });
        expect(() => store.claimItem('item-1')).toThrow(/paused/);
    });

    it('rejects claim of a different item while one is active without replaceActive', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        expect(() => store.claimItem('item-b')).toThrow(/activeItemId/);
    });

    it('allows re-claim of the same active item without replaceActive', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        expect(() => store.claimItem('item-a')).not.toThrow();
    });

    it('replaces the active item when replaceActive is true', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        const next = store.claimItem('item-b', { replaceActive: true });
        expect(next.activeItemId).toBe('item-b');
    });
});

describe('WorkRunsStore — completeActiveItem', () => {
    it('clears active and appends to completedItemIds', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        const after = store.completeActiveItem();
        expect(after.activeItemId).toBeNull();
        expect(after.completedItemIds).toEqual(['item-a']);
    });

    it('dedupes when the same id is completed twice across runs of the array', () => {
        const { store } = makeStore();
        const r = store.create({
            subjectId: 's',
            mode: 'ready_queue',
            activeItemId: 'item-a',
        });
        store.update(r.id, { completedItemIds: ['item-a'] });
        // Re-claim and re-complete: dedup keeps the list at one entry.
        store.claimItem('item-a');
        const after = store.completeActiveItem();
        expect(after.completedItemIds).toEqual(['item-a']);
    });

    it('rejects when there is no active item', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue' });
        expect(() => store.completeActiveItem()).toThrow(/no active item/);
    });
});

describe('WorkRunsStore — blockActiveItem', () => {
    it('flips to blocked, retains active, appends to blockedItemIds, sets notes', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        const after = store.blockActiveItem({ notes: 'waiting on stakeholder' });
        expect(after.status).toBe('blocked');
        expect(after.activeItemId).toBe('item-a');
        expect(after.blockedItemIds).toEqual(['item-a']);
        expect(after.notes).toBe('waiting on stakeholder');
    });

    it('rejects when there is no active item', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue' });
        expect(() => store.blockActiveItem({ notes: 'x' })).toThrow(/no active item/);
    });

    it('rejects when run is not running (already blocked)', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        store.blockActiveItem({ notes: 'first block' });
        // Now current() returns the blocked run, but requireRunning fails.
        expect(() => store.blockActiveItem({ notes: 'second block' })).toThrow(/blocked/);
    });
});

describe('WorkRunsStore — finishEmpty', () => {
    it('flips a no-active running run to completed', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue' });
        const after = store.finishEmpty({ notes: 'nothing left' });
        expect(after.status).toBe('completed');
        expect(after.activeItemId).toBeNull();
        expect(after.endedAt).not.toBeNull();
        expect(after.notes).toBe('nothing left');
    });

    it('rejects when an item is still active', () => {
        const { store } = makeStore();
        store.create({ subjectId: 's', mode: 'ready_queue', activeItemId: 'item-a' });
        expect(() => store.finishEmpty({ notes: 'x' })).toThrow(/active item/);
    });
});

describe('JsonFileStorage', () => {
    let tmp: string;
    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), 'work-runs-storage-'));
    });

    it('reads an empty list when the file does not exist', () => {
        const storage = new JsonFileStorage(join(tmp, 'sub', 'runs.json'));
        expect(storage.readAll()).toEqual([]);
        rmSync(tmp, { recursive: true, force: true });
    });

    it('creates the parent directory on write', () => {
        const filePath = join(tmp, 'nested', 'dir', 'runs.json');
        const storage = new JsonFileStorage(filePath);
        storage.writeAll([
            {
                id: 'r1',
                subjectId: 's',
                status: 'running',
                mode: 'ready_queue',
                scope: '',
                startedAt: '2026-06-06T00:00:00Z',
                endedAt: null,
                startedBy: 'user',
                activeItemId: null,
                completedItemIds: [],
                blockedItemIds: [],
                createdItemIds: [],
                notes: '',
            },
        ]);
        const reloaded = new JsonFileStorage(filePath).readAll();
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0].id).toBe('r1');
        rmSync(tmp, { recursive: true, force: true });
    });

    it('tolerates malformed JSON by returning an empty list', () => {
        const filePath = join(tmp, 'runs.json');
        mkdirSync(tmp, { recursive: true });
        writeFileSync(filePath, 'not json{');
        expect(new JsonFileStorage(filePath).readAll()).toEqual([]);
        rmSync(tmp, { recursive: true, force: true });
    });

    it('persists the store round-trip', () => {
        const filePath = join(tmp, 'runs.json');
        const store = new WorkRunsStore({ storage: new JsonFileStorage(filePath) });
        const run = store.create({ subjectId: 's', mode: 'ready_queue' });
        // Reload from a fresh store pointing at the same file.
        const reopened = new WorkRunsStore({
            storage: new JsonFileStorage(filePath),
        });
        expect(reopened.get(run.id)?.id).toBe(run.id);
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(Array.isArray(parsed.runs)).toBe(true);
        rmSync(tmp, { recursive: true, force: true });
    });
});
