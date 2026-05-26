import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { MODEL_SETTINGS_MIGRATIONS } from '../migrations.js';
import { ModelSettingsStore, SUITE_OWNER_ID } from '../store.js';

let db: DatabaseInstance;

beforeEach(() => {
  db = openDb({ path: ':memory:', migrations: MODEL_SETTINGS_MIGRATIONS });
});

afterEach(() => {
  db.close();
});

describe('scope: "global"', () => {
  it('collapses any ownerId arg to the SUITE_OWNER_ID sentinel', () => {
    const store = new ModelSettingsStore({ db, envRegistry: {}, scope: 'global' });

    // Write as one "owner", read as a different one — both should see the
    // same row in global mode.
    store.setProviderKey('alice@example.com', 'openai', 'sk-shared');
    expect(store.getProviderKey('bob@example.com', 'openai')).toBe('sk-shared');
    expect(store.getProviderKey(null, 'openai')).toBe('sk-shared');
    expect(store.getProviderKey(SUITE_OWNER_ID, 'openai')).toBe('sk-shared');

    // The row is physically stored under the sentinel.
    const row = db
      .prepare<[], { owner_id: string }>('SELECT owner_id FROM provider_keys')
      .get();
    expect(row?.owner_id).toBe(SUITE_OWNER_ID);
  });

  it('per-user scope still isolates owners', () => {
    const store = new ModelSettingsStore({ db, envRegistry: {}, scope: 'per-user' });
    store.setProviderKey('alice@example.com', 'openai', 'sk-alice');
    expect(store.getProviderKey('bob@example.com', 'openai')).toBeNull();
  });

  it('default-model meta is also shared in global mode', () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      scope: 'global',
      providerCatalog: [
        { key: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', models: ['gpt-4o'] },
      ],
    });
    store.setDefaultModel('alice', 'openai:gpt-4o');
    expect(store.getDefaultModel('bob')).toBe('openai:gpt-4o');
    expect(store.getDefaultModel(null)).toBe('openai:gpt-4o');
  });

  it('throws on writes when per-user owner is missing', () => {
    const store = new ModelSettingsStore({ db, envRegistry: {}, scope: 'per-user' });
    expect(() => store.setProviderKey(null, 'openai', 'sk-test')).toThrow(/ownerId required/);
    expect(() => store.setDefaultModel(null, 'irrelevant')).toThrow(/ownerId required/);
  });

  it('exposes scope via getScope()', () => {
    expect(new ModelSettingsStore({ db, envRegistry: {} }).getScope()).toBe('per-user');
    expect(
      new ModelSettingsStore({ db, envRegistry: {}, scope: 'global' }).getScope(),
    ).toBe('global');
  });
});
