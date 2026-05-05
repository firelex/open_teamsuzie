import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { MODEL_SETTINGS_MIGRATIONS } from '../migrations.js';
import { ModelSettingsStore } from '../store.js';

let db: DatabaseInstance;
let store: ModelSettingsStore;

beforeEach(() => {
  db = openDb({ path: ':memory:', migrations: MODEL_SETTINGS_MIGRATIONS });
  store = new ModelSettingsStore({ db, envRegistry: {} });
});

afterEach(() => {
  db.close();
});

describe('provider keys migration', () => {
  it('creates the provider_keys table with the right shape', () => {
    const cols = db
      .prepare<[], { name: string }>(`PRAGMA table_info('provider_keys')`)
      .all()
      .map((r) => r.name)
      .sort();
    expect(cols).toEqual(
      ['api_key', 'owner_id', 'provider_id', 'updated_at'].sort(),
    );
  });
});

describe('setProviderKey + getProviderKey', () => {
  it('round-trips a key', () => {
    store.setProviderKey('user@example.com', 'openai', 'sk-test-123');
    expect(store.getProviderKey('user@example.com', 'openai')).toBe(
      'sk-test-123',
    );
  });

  it('upserts on duplicate (owner, provider)', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-old');
    store.setProviderKey('u@e.com', 'openai', 'sk-new');
    expect(store.getProviderKey('u@e.com', 'openai')).toBe('sk-new');
    expect(store.listProviderKeyRows('u@e.com').length).toBe(1);
  });

  it('trims whitespace before storing', () => {
    store.setProviderKey('u@e.com', 'openai', '  sk-test  ');
    expect(store.getProviderKey('u@e.com', 'openai')).toBe('sk-test');
  });

  it('rejects empty / whitespace-only keys', () => {
    expect(() => store.setProviderKey('u@e.com', 'openai', '')).toThrow();
    expect(() => store.setProviderKey('u@e.com', 'openai', '   ')).toThrow();
  });

  it('returns null for unset keys', () => {
    expect(store.getProviderKey('u@e.com', 'openai')).toBeNull();
  });

  it('isolates keys across users', () => {
    store.setProviderKey('a@e.com', 'openai', 'sk-a');
    store.setProviderKey('b@e.com', 'openai', 'sk-b');
    expect(store.getProviderKey('a@e.com', 'openai')).toBe('sk-a');
    expect(store.getProviderKey('b@e.com', 'openai')).toBe('sk-b');
  });

  it('isolates keys across providers for the same user', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-openai');
    store.setProviderKey('u@e.com', 'dashscope', 'sk-dash');
    expect(store.getProviderKey('u@e.com', 'openai')).toBe('sk-openai');
    expect(store.getProviderKey('u@e.com', 'dashscope')).toBe('sk-dash');
  });
});

describe('clearProviderKey', () => {
  it('removes a key and returns true', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-test');
    expect(store.clearProviderKey('u@e.com', 'openai')).toBe(true);
    expect(store.getProviderKey('u@e.com', 'openai')).toBeNull();
  });

  it('returns false when no row matches', () => {
    expect(store.clearProviderKey('u@e.com', 'openai')).toBe(false);
  });
});

describe('publicProviderKeys', () => {
  it('returns one row per requested provider with hasKey=false when unset', () => {
    const out = store.publicProviderKeys('u@e.com', ['openai', 'dashscope']);
    expect(out).toEqual([
      { providerId: 'openai', hasKey: false, updatedAt: 0 },
      { providerId: 'dashscope', hasKey: false, updatedAt: 0 },
    ]);
  });

  it('flips hasKey to true when a key exists', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-test');
    const out = store.publicProviderKeys('u@e.com', ['openai', 'dashscope']);
    expect(out[0]?.hasKey).toBe(true);
    expect(out[0]?.updatedAt).toBeGreaterThan(0);
    expect(out[1]?.hasKey).toBe(false);
  });

  it('never echoes the key value', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-secret');
    const out = store.publicProviderKeys('u@e.com', ['openai']);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('sk-secret');
  });

  it('treats null ownerId as unauthenticated (no keys)', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-test');
    const out = store.publicProviderKeys(null, ['openai']);
    expect(out).toEqual([
      { providerId: 'openai', hasKey: false, updatedAt: 0 },
    ]);
  });
});
