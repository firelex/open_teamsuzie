import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { decrypt, encrypt } from '@teamsuzie/crypto';

import { MODEL_SETTINGS_MIGRATIONS } from '../migrations.js';
import { ModelSettingsStore, type EncryptionAdapter } from '../store.js';

const SECRET = 'unit-test-master-key-do-not-use-in-prod';
const adapter: EncryptionAdapter = {
  encrypt: (p) => encrypt(p, SECRET),
  decrypt: (c) => decrypt(c, SECRET),
};

let db: DatabaseInstance;

beforeEach(() => {
  db = openDb({ path: ':memory:', migrations: MODEL_SETTINGS_MIGRATIONS });
});

afterEach(() => {
  db.close();
});

function rawApiKey(providerId: string): string | undefined {
  return db
    .prepare<[string], { api_key: string }>(
      'SELECT api_key FROM provider_keys WHERE provider_id = ?',
    )
    .get(providerId)?.api_key;
}

describe('encryption adapter', () => {
  it('round-trips provider keys when encryption is enabled', () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      encryption: adapter,
    });
    store.setProviderKey('u@e.com', 'openai', 'sk-secret-123');
    expect(store.getProviderKey('u@e.com', 'openai')).toBe('sk-secret-123');
  });

  it('stores ciphertext at rest, not plaintext', () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      encryption: adapter,
    });
    store.setProviderKey('u@e.com', 'openai', 'sk-secret-123');

    const raw = rawApiKey('openai');
    expect(raw).toBeDefined();
    expect(raw).not.toBe('sk-secret-123');
    expect(raw!.startsWith('enc:v1:')).toBe(true);
  });

  it('keeps existing plaintext readable after enabling encryption (back-compat)', () => {
    // Write plaintext first (no adapter).
    const plain = new ModelSettingsStore({ db, envRegistry: {} });
    plain.setProviderKey('u@e.com', 'openai', 'sk-legacy');

    // Re-open with encryption — old row stays readable until next write.
    const enc = new ModelSettingsStore({
      db,
      envRegistry: {},
      encryption: adapter,
    });
    expect(enc.getProviderKey('u@e.com', 'openai')).toBe('sk-legacy');

    // Next write should be encrypted.
    enc.setProviderKey('u@e.com', 'openai', 'sk-fresh');
    expect(rawApiKey('openai')!.startsWith('enc:v1:')).toBe(true);
    expect(enc.getProviderKey('u@e.com', 'openai')).toBe('sk-fresh');
  });

  it('returns null for encrypted rows when read without the adapter (lost key)', () => {
    const enc = new ModelSettingsStore({
      db,
      envRegistry: {},
      encryption: adapter,
    });
    enc.setProviderKey('u@e.com', 'openai', 'sk-secret');

    const noAdapter = new ModelSettingsStore({ db, envRegistry: {} });
    expect(noAdapter.getProviderKey('u@e.com', 'openai')).toBeNull();
  });

  it('encrypts local-model api keys too', () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      localModels: [
        {
          id: 'local-test',
          name: 'Test',
          provider: 'Local',
          description: '',
          local: true,
          installUrl: '',
          envSuffix: 'TEST',
          defaultBaseUrl: 'http://localhost:9999',
        },
      ],
      encryption: adapter,
    });
    store.setOverride('u@e.com', 'local-test', 'http://localhost:8888', 'sk-local');

    const raw = db
      .prepare<[], { api_key: string }>('SELECT api_key FROM model_settings')
      .get()?.api_key;
    expect(raw!.startsWith('enc:v1:')).toBe(true);

    expect(store.effectiveRegistry('u@e.com')['local-test']?.apiKey).toBe('sk-local');
  });
});
