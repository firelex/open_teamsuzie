import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { MODEL_SETTINGS_MIGRATIONS } from '../migrations.js';
import { ModelSettingsStore, type ProviderDef } from '../store.js';

const CATALOG: ProviderDef[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet', 'claude-3-7-sonnet'],
  },
  {
    key: 'custom',
    label: 'Custom',
    // No defaultBaseUrl on purpose — host expects the owner to supply one.
    models: [],
  },
];

let db: DatabaseInstance;
let store: ModelSettingsStore;

beforeEach(() => {
  db = openDb({ path: ':memory:', migrations: MODEL_SETTINGS_MIGRATIONS });
  store = new ModelSettingsStore({
    db,
    envRegistry: {},
    providerCatalog: CATALOG,
  });
});

afterEach(() => {
  db.close();
});

describe('publicProviderKeys + catalog', () => {
  it('iterates in catalog order and surfaces defaultBaseUrl', () => {
    const out = store.publicProviderKeys('u@e.com');
    expect(out.map((r) => r.providerId)).toEqual(['openai', 'anthropic', 'custom']);
    expect(out[0]).toMatchObject({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      hasBaseUrlOverride: false,
      hasKey: false,
    });
    expect(out[2]?.baseUrl).toBeNull(); // 'custom' has no default
  });

  it('flags hasBaseUrlOverride when the owner sets baseUrl', () => {
    store.setProviderKey('u@e.com', 'openai', { apiKey: 'sk-x', baseUrl: 'https://proxy.example.com/v1' });
    const row = store.publicProviderKeys('u@e.com').find((r) => r.providerId === 'openai');
    expect(row?.baseUrl).toBe('https://proxy.example.com/v1');
    expect(row?.hasBaseUrlOverride).toBe(true);
  });
});

describe('setDefaultModel validation', () => {
  it('accepts "{provider}:{model}" when both are in the catalog', () => {
    store.setDefaultModel('u@e.com', 'openai:gpt-4o');
    expect(store.getDefaultModel('u@e.com')).toBe('openai:gpt-4o');
  });

  it('accepts a bare model id that exists in any catalog provider', () => {
    store.setDefaultModel('u@e.com', 'claude-3-5-sonnet');
    expect(store.getDefaultModel('u@e.com')).toBe('claude-3-5-sonnet');
  });

  it('rejects unknown providers', () => {
    expect(() => store.setDefaultModel('u@e.com', 'pirate:gpt-4o')).toThrow(/Unknown provider/);
  });

  it('rejects models not in the chosen provider', () => {
    expect(() => store.setDefaultModel('u@e.com', 'openai:claude-3')).toThrow(/not in provider/);
  });

  it('accepts any model string for a catalog entry with empty models list', () => {
    store.setDefaultModel('u@e.com', 'custom:my-private-model');
    expect(store.getDefaultModel('u@e.com')).toBe('custom:my-private-model');
  });

  it('rejects unknown bare model ids', () => {
    expect(() => store.setDefaultModel('u@e.com', 'made-up-model')).toThrow(/Unknown model/);
  });
});

describe('resolveDefault', () => {
  it('returns null when no default is set', () => {
    expect(store.resolveDefault('u@e.com')).toBeNull();
  });

  it('resolves a "{provider}:{model}" default via the catalog defaults', () => {
    store.setProviderKey('u@e.com', 'openai', 'sk-test');
    store.setDefaultModel('u@e.com', 'openai:gpt-4o-mini');

    expect(store.resolveDefault('u@e.com')).toEqual({
      modelId: 'openai:gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });
  });

  it('honors the per-provider baseUrl override', () => {
    store.setProviderKey('u@e.com', 'openai', {
      apiKey: 'sk-test',
      baseUrl: 'https://proxy.example.com/v1',
    });
    store.setDefaultModel('u@e.com', 'openai:gpt-4o');

    expect(store.resolveDefault('u@e.com')).toMatchObject({
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-test',
    });
  });

  it('returns null when the provider has no defaultBaseUrl and no override', () => {
    // Bypass setDefaultModel's validation (which would also fail) by
    // writing meta directly — simulates a stale default after the catalog
    // changed.
    store.setMeta('u@e.com', 'default_model', 'custom:freeform');
    expect(store.resolveDefault('u@e.com')).toBeNull();
  });

  it('resolves a local model via the env registry', () => {
    const local = new ModelSettingsStore({
      db,
      envRegistry: { 'Qwen/Qwen3.6-35B-A3B': { baseUrl: 'http://localhost:9000', apiKey: 'k' } },
    });
    local.setDefaultModel('u@e.com', 'Qwen/Qwen3.6-35B-A3B');
    expect(local.resolveDefault('u@e.com')).toEqual({
      modelId: 'Qwen/Qwen3.6-35B-A3B',
      baseUrl: 'http://localhost:9000',
      apiKey: 'k',
      model: 'Qwen/Qwen3.6-35B-A3B',
    });
  });
});

describe('global-scope catalog resolution', () => {
  it('one default_model is visible to all callers', () => {
    const globalStore = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
      scope: 'global',
    });
    globalStore.setProviderKey('whoever', 'openai', 'sk-shared');
    globalStore.setDefaultModel('whoever', 'openai:gpt-4o');

    expect(globalStore.resolveDefault('different-user')).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-shared',
      model: 'gpt-4o',
    });
  });
});
