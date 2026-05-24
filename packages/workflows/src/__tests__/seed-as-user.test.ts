import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkflowsStore, WORKFLOWS_MIGRATIONS } from '../index.js';
import type { WorkflowSeed } from '../types.js';

const seeds: WorkflowSeed[] = [
  { id: 'p1', name: 'First',  prompt: 'p1 body', description: '', practiceAreas: [], outputMode: 'inline_chat' },
  { id: 'p2', name: 'Second', prompt: 'p2 body', description: '', practiceAreas: [], outputMode: 'inline_chat' },
];

describe('WorkflowsStore.seedAsUserIfEmpty', () => {
  let db: DatabaseInstance;
  let store: WorkflowsStore;

  beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: WORKFLOWS_MIGRATIONS });
    store = new WorkflowsStore({ db });
  });

  afterEach(() => {
    db.close();
  });

  it('seeds items as user-owned on first call', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    const items = store.listVisible({ ownerId: 'user-1' });
    expect(items).toHaveLength(2);
    for (const w of items) expect(w.source).toBe('user');
    expect(items.map(w => w.id).sort()).toEqual(['p1', 'p2']);
  });

  it('is idempotent: second call inserts nothing', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    expect(store.listVisible({ ownerId: 'user-1' })).toHaveLength(2);
  });

  it('does not re-introduce a deleted seed', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    store.deleteUserWorkflow('p1', 'user-1');
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    const items = store.listVisible({ ownerId: 'user-1' });
    expect(items.map(w => w.id)).toEqual(['p2']);
  });

  it('preserves user edits across re-seed', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    store.updateUserWorkflow('p1', 'user-1', { prompt: 'edited body' });
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    const p1 = store.listVisible({ ownerId: 'user-1' }).find(w => w.id === 'p1');
    expect(p1?.prompt).toBe('edited body');
  });
});
