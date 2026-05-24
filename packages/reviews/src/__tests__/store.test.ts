import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { REVIEWS_MIGRATIONS } from '../migrations.js';
import { ReviewsStore } from '../store.js';
import type { ReviewColumn } from '../types.js';

let db: DatabaseInstance;
let store: ReviewsStore;

beforeEach(() => {
  db = openDb({ path: ':memory:', migrations: REVIEWS_MIGRATIONS });
  store = new ReviewsStore({ db });
});

afterEach(() => {
  db.close();
});

const sampleColumns = (): ReviewColumn[] => [
  { id: 'col_a', title: 'A', prompt: 'pa', format: 'text' },
  { id: 'col_b', title: 'B', prompt: 'pb', format: 'number' },
];

describe('migrations', () => {
  it('creates the expected tables', () => {
    const tables = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain('review_templates');
    expect(tables).toContain('reviews');
    expect(tables).toContain('review_seeds_applied');
  });
});

describe('System templates', () => {
  it('upserts idempotently', () => {
    store.upsertSystemTemplate({
      id: 'system:credit-summary',
      name: 'Credit summary',
      description: 'd',
      columns: sampleColumns(),
    });
    store.upsertSystemTemplate({
      id: 'system:credit-summary',
      name: 'Credit summary v2',
      columns: [
        { id: 'col_c', title: 'C', prompt: 'pc', format: 'date' },
      ],
    });
    const t = store.getTemplate('system:credit-summary')!;
    expect(t.source).toBe('system');
    expect(t.ownerId).toBeNull();
    expect(t.name).toBe('Credit summary v2');
    expect(t.columns).toHaveLength(1);
    expect(t.columns[0].id).toBe('col_c');
  });

  it('seedSystemTemplates upserts known ids and removes stale ones', () => {
    store.upsertSystemTemplate({ id: 'a', name: 'A', columns: [] });
    store.upsertSystemTemplate({ id: 'b', name: 'B', columns: [] });
    store.upsertSystemTemplate({ id: 'c', name: 'C', columns: [] });

    const result = store.seedSystemTemplates([
      { id: 'b', name: 'B (renamed)', columns: [] },
      { id: 'd', name: 'D', columns: [] },
    ]);
    expect(result.upserted).toBe(2);
    expect(result.removed).toBe(2);

    const sysIds = store
      .listTemplatesBySource('system')
      .map((t) => t.id)
      .sort();
    expect(sysIds).toEqual(['b', 'd']);
    expect(store.getTemplate('b')!.name).toBe('B (renamed)');
  });

  it('rejects updates to system templates via the user path', () => {
    store.upsertSystemTemplate({ id: 'sys:a', name: 'A', columns: [] });
    const result = store.updateUserTemplate('sys:a', 'someone@example.com', {
      name: 'forbidden',
    });
    expect(result).toBeNull();
    expect(store.getTemplate('sys:a')!.name).toBe('A');
  });
});

describe('User templates', () => {
  it('creates with normalized fields', () => {
    const t = store.createUserTemplate({
      ownerId: 'alice@example.com',
      name: 'Quick review',
      columns: sampleColumns(),
    });
    expect(t.source).toBe('user');
    expect(t.ownerId).toBe('alice@example.com');
    expect(t.description).toBeUndefined();
    expect(t.columns).toHaveLength(2);
    expect(t.columns[0].format).toBe('text');
  });

  it('updates only when owner matches', () => {
    const t = store.createUserTemplate({
      ownerId: 'alice@example.com',
      name: 'A',
      columns: sampleColumns(),
    });
    expect(
      store.updateUserTemplate(t.id, 'mallory@example.com', { name: 'pwned' }),
    ).toBeNull();
    expect(store.getTemplate(t.id)!.name).toBe('A');

    const updated = store.updateUserTemplate(t.id, 'alice@example.com', {
      name: 'A2',
      columns: [{ id: 'x', title: 'X', prompt: 'p', format: 'currency' }],
    });
    expect(updated!.name).toBe('A2');
    expect(updated!.columns).toHaveLength(1);
    expect(updated!.columns[0].format).toBe('currency');
  });

  it('delete refuses for non-owner and for system templates', () => {
    const t = store.createUserTemplate({
      ownerId: 'a',
      name: 'A',
      columns: [],
    });
    store.upsertSystemTemplate({ id: 'sys', name: 'Sys', columns: [] });
    expect(store.deleteUserTemplate(t.id, 'b')).toBe(false);
    expect(store.deleteUserTemplate('sys', 'a')).toBe(false);
    expect(store.deleteUserTemplate(t.id, 'a')).toBe(true);
    expect(store.getTemplate(t.id)).toBeNull();
  });

  it('rowToTemplate tolerates corrupt columns_json', () => {
    store.upsertSystemTemplate({ id: 'sys:bad', name: 'Bad', columns: [] });
    db.prepare(
      `UPDATE review_templates SET columns_json = ? WHERE id = ?`,
    ).run('not valid json', 'sys:bad');
    const t = store.getTemplate('sys:bad')!;
    expect(t.columns).toEqual([]);
  });
});

describe('Templates visibility (listTemplatesVisible)', () => {
  beforeEach(() => {
    store.upsertSystemTemplate({ id: 's1', name: 'Sys 1', columns: [] });
    store.upsertSystemTemplate({ id: 's2', name: 'Sys 2', columns: [] });
    store.createUserTemplate({
      ownerId: 'alice@example.com',
      name: 'Alice 1',
      columns: [],
    });
    store.createUserTemplate({
      ownerId: 'bob@example.com',
      name: 'Bob 1',
      columns: [],
    });
  });

  it('alice sees system + her own user templates, not bobs', () => {
    const visible = store.listTemplatesVisible({ ownerId: 'alice@example.com' });
    const names = visible.map((t) => t.name).sort();
    expect(names).toEqual(['Alice 1', 'Sys 1', 'Sys 2']);
  });

  it('bob sees system + his own user templates, not alices', () => {
    const visible = store.listTemplatesVisible({ ownerId: 'bob@example.com' });
    const names = visible.map((t) => t.name).sort();
    expect(names).toEqual(['Bob 1', 'Sys 1', 'Sys 2']);
  });
});

describe('Reviews CRUD', () => {
  it('creates with normalized fields and optional templateId', () => {
    const r = store.createUserReview({
      ownerId: 'alice@example.com',
      name: 'My review',
      templateId: 'tpl-123',
      rows: [{ col_a: 'one' }, { col_a: 'two' }],
    });
    expect(r.ownerId).toBe('alice@example.com');
    expect(r.templateId).toBe('tpl-123');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].col_a).toBe('one');
  });

  it('defaults rows to [] and templateId to null when omitted', () => {
    const r = store.createUserReview({
      ownerId: 'alice@example.com',
      name: 'Bare',
    });
    expect(r.rows).toEqual([]);
    expect(r.templateId).toBeNull();
  });

  it('getReview enforces owner-only visibility', () => {
    const r = store.createUserReview({
      ownerId: 'alice@example.com',
      name: 'Private',
    });
    expect(store.getReview(r.id, 'alice@example.com')!.name).toBe('Private');
    expect(store.getReview(r.id, 'mallory@example.com')).toBeNull();
  });

  it('listReviewsVisible returns only owner reviews, newest-updated first', () => {
    const r1 = store.createUserReview({ ownerId: 'a', name: 'one' });
    const r2 = store.createUserReview({ ownerId: 'a', name: 'two' });
    store.createUserReview({ ownerId: 'b', name: 'bobs' });
    // Touch r1 to push it ahead of r2.
    store.updateUserReview(r1.id, 'a', { name: 'one-edited' });
    const list = store.listReviewsVisible({ ownerId: 'a' });
    expect(list.map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(list[0].name).toBe('one-edited');
  });

  it('update refuses non-owner; replaces rows when provided', () => {
    const r = store.createUserReview({
      ownerId: 'alice@example.com',
      name: 'R',
      rows: [{ x: 1 }],
    });
    expect(
      store.updateUserReview(r.id, 'mallory@example.com', { rows: [] }),
    ).toBeNull();
    const updated = store.updateUserReview(r.id, 'alice@example.com', {
      rows: [{ y: 'new' }, { y: 'er' }],
    });
    expect(updated!.rows).toEqual([{ y: 'new' }, { y: 'er' }]);
  });

  it('update with omitted rows leaves rows untouched', () => {
    const r = store.createUserReview({
      ownerId: 'a',
      name: 'R',
      rows: [{ x: 1 }],
    });
    const updated = store.updateUserReview(r.id, 'a', { name: 'R2' });
    expect(updated!.name).toBe('R2');
    expect(updated!.rows).toEqual([{ x: 1 }]);
  });

  it('delete refuses non-owner', () => {
    const r = store.createUserReview({ ownerId: 'a', name: 'R' });
    expect(store.deleteUserReview(r.id, 'b')).toBe(false);
    expect(store.deleteUserReview(r.id, 'a')).toBe(true);
    expect(store.getReview(r.id, 'a')).toBeNull();
  });

  it('rowToReview tolerates corrupt rows_json', () => {
    const r = store.createUserReview({ ownerId: 'a', name: 'R' });
    db.prepare(`UPDATE reviews SET rows_json = ? WHERE id = ?`).run(
      'not valid json',
      r.id,
    );
    expect(store.getReview(r.id, 'a')!.rows).toEqual([]);
  });
});
