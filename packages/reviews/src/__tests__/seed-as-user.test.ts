import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { ReviewsStore, REVIEWS_MIGRATIONS } from '../index.js';
import type { ReviewTemplateSeed } from '../types.js';

const seeds: ReviewTemplateSeed[] = [
  {
    id: 't1',
    name: 'First',
    description: '',
    columns: [{ id: 'c1', title: 'C1', prompt: 'p1', format: 'text' }],
  },
  {
    id: 't2',
    name: 'Second',
    description: '',
    columns: [{ id: 'c2', title: 'C2', prompt: 'p2', format: 'number' }],
  },
];

describe('ReviewsStore.seedAsUserIfEmpty', () => {
  let db: DatabaseInstance;
  let store: ReviewsStore;

  beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: REVIEWS_MIGRATIONS });
    store = new ReviewsStore({ db });
  });

  afterEach(() => {
    db.close();
  });

  it('seeds templates as user-owned on first call', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    const items = store.listTemplatesVisible({ ownerId: 'user-1' });
    expect(items).toHaveLength(2);
    for (const t of items) expect(t.source).toBe('user');
    expect(items.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('is idempotent: second call inserts nothing', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    expect(store.listTemplatesVisible({ ownerId: 'user-1' })).toHaveLength(2);
  });

  it('does not re-introduce a deleted seed', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    store.deleteUserTemplate('t1', 'user-1');
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    const items = store.listTemplatesVisible({ ownerId: 'user-1' });
    expect(items.map((t) => t.id)).toEqual(['t2']);
  });

  it('preserves user edits across re-seed', () => {
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    store.updateUserTemplate('t1', 'user-1', {
      columns: [{ id: 'cX', title: 'edited', prompt: 'p', format: 'date' }],
    });
    store.seedAsUserIfEmpty('demo', seeds, 'user-1');
    const t1 = store
      .listTemplatesVisible({ ownerId: 'user-1' })
      .find((t) => t.id === 't1');
    expect(t1?.columns).toHaveLength(1);
    expect(t1?.columns[0].title).toBe('edited');
  });
});
