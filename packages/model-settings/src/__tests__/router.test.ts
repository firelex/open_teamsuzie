import express from 'express';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { MODEL_SETTINGS_MIGRATIONS } from '../migrations.js';
import {
  ModelSettingsStore,
  SUITE_OWNER_ID,
  type ProviderDef,
} from '../store.js';
import { createModelSettingsRouter } from '../router.js';

const CATALOG: ProviderDef[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o'],
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    models: [{ id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' }],
  },
];

let db: DatabaseInstance;

beforeEach(() => {
  db = openDb({ path: ':memory:', migrations: MODEL_SETTINGS_MIGRATIONS });
});

afterEach(() => {
  db.close();
});

function mountPerUser(store: ModelSettingsStore, opts?: { allowLocal?: boolean }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/model-settings',
    createModelSettingsRouter({
      store,
      getOwnerId: (req) => req.header('x-test-user') || null,
      allowLocalProviderUrl: opts?.allowLocal,
      serviceTokenGuard: (req, res, next) => {
        if (req.header('x-service-key') === 'svc-secret') return next();
        res.status(401).json({ error: 'service auth required' });
      },
    }),
  );
  return app;
}

function mountGlobal(store: ModelSettingsStore) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/model-settings',
    createModelSettingsRouter({
      store,
      // no getOwnerId — global scope should fall back to the sentinel
      serviceTokenGuard: (req, res, next) => {
        if (req.header('x-service-key') === 'svc-secret') return next();
        res.status(401).json({ error: 'service auth required' });
      },
    }),
  );
  return app;
}

describe('GET /providers/catalog', () => {
  it('is mounted only when the store has a catalog', async () => {
    const withCatalog = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
    );
    const r1 = await supertest(withCatalog)
      .get('/api/model-settings/providers/catalog')
      .set('x-test-user', 'u@e.com');
    expect(r1.status).toBe(200);
    expect(r1.body.providers).toEqual([
      {
        key: 'openai',
        label: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o', label: 'gpt-4o' }],
      },
      {
        key: 'anthropic',
        label: 'Anthropic',
        defaultBaseUrl: 'https://api.anthropic.com/v1',
        models: [{ id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' }],
      },
    ]);

    const withoutCatalog = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {} }),
    );
    const r2 = await supertest(withoutCatalog).get('/api/model-settings/providers/catalog');
    expect(r2.status).toBe(404);
  });
});

describe('PUT /providers/:id with public-only validator', () => {
  it('accepts a public baseUrl + apiKey together', async () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
    });
    const app = mountPerUser(store);

    const r = await supertest(app)
      .put('/api/model-settings/providers/openai')
      .set('x-test-user', 'u@e.com')
      .send({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' });
    expect(r.status).toBe(200);

    expect(store.getProviderKey('u@e.com', 'openai')).toBe('sk-test');
    expect(store.getProviderRecord('u@e.com', 'openai')?.baseUrl).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('rejects loopback baseUrl by default', async () => {
    const app = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
    );
    const r = await supertest(app)
      .put('/api/model-settings/providers/openai')
      .set('x-test-user', 'u@e.com')
      .send({ apiKey: 'sk', baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/loopback|private|refusing/i);
  });

  it('allows loopback when allowLocalProviderUrl is on (dev mode)', async () => {
    const app = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
      { allowLocal: true },
    );
    const r = await supertest(app)
      .put('/api/model-settings/providers/openai')
      .set('x-test-user', 'u@e.com')
      .send({ apiKey: 'sk', baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(r.status).toBe(200);
  });

  it('400s when nothing meaningful is sent', async () => {
    const app = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
    );
    const r = await supertest(app)
      .put('/api/model-settings/providers/openai')
      .set('x-test-user', 'u@e.com')
      .send({});
    expect(r.status).toBe(400);
  });
});

describe('default-model endpoints', () => {
  it('GET → PUT → GET round-trips per user', async () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
    });
    const app = mountPerUser(store);

    const r0 = await supertest(app)
      .get('/api/model-settings/default')
      .set('x-test-user', 'u@e.com');
    expect(r0.body).toEqual({ default_model: null });

    const r1 = await supertest(app)
      .put('/api/model-settings/default')
      .set('x-test-user', 'u@e.com')
      .send({ default_model: 'openai:gpt-4o' });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ default_model: 'openai:gpt-4o' });

    const r2 = await supertest(app)
      .get('/api/model-settings/default')
      .set('x-test-user', 'u@e.com');
    expect(r2.body).toEqual({ default_model: 'openai:gpt-4o' });
  });

  it('400s on unknown models', async () => {
    const app = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
    );
    const r = await supertest(app)
      .put('/api/model-settings/default')
      .set('x-test-user', 'u@e.com')
      .send({ default_model: 'fake:model' });
    expect(r.status).toBe(400);
  });

  it('PUT with default_model: null clears the value', async () => {
    const app = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
    );
    await supertest(app)
      .put('/api/model-settings/default')
      .set('x-test-user', 'u@e.com')
      .send({ default_model: 'openai:gpt-4o' });
    const r = await supertest(app)
      .put('/api/model-settings/default')
      .set('x-test-user', 'u@e.com')
      .send({ default_model: null });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ default_model: null });
  });
});

describe('GET /effective (service-token guarded)', () => {
  it('401s without the service key', async () => {
    const app = mountPerUser(
      new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG }),
    );
    const r = await supertest(app)
      .get('/api/model-settings/effective')
      .set('x-test-user', 'u@e.com');
    expect(r.status).toBe(401);
  });

  it('per-user: requires x-owner-id header and returns plaintext credentials', async () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
    });
    store.setProviderKey('u@e.com', 'openai', 'sk-rt');
    store.setDefaultModel('u@e.com', 'openai:gpt-4o');
    const app = mountPerUser(store);

    const r0 = await supertest(app)
      .get('/api/model-settings/effective')
      .set('x-service-key', 'svc-secret');
    expect(r0.status).toBe(400); // missing x-owner-id

    const r1 = await supertest(app)
      .get('/api/model-settings/effective')
      .set('x-service-key', 'svc-secret')
      .set('x-owner-id', 'u@e.com');
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-rt',
      model: 'gpt-4o',
      model_id: 'openai:gpt-4o',
    });
  });

  it('global: no x-owner-id header needed', async () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
      scope: 'global',
    });
    store.setProviderKey(null, 'openai', 'sk-global');
    store.setDefaultModel(null, 'openai:gpt-4o');
    const app = mountGlobal(store);

    const r = await supertest(app)
      .get('/api/model-settings/effective')
      .set('x-service-key', 'svc-secret');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-global',
      model: 'gpt-4o',
      model_id: 'openai:gpt-4o',
    });
  });

  it('404s when no default is configured', async () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
      scope: 'global',
    });
    const app = mountGlobal(store);
    const r = await supertest(app)
      .get('/api/model-settings/effective')
      .set('x-service-key', 'svc-secret');
    expect(r.status).toBe(404);
  });
});

describe('global-scope router needs no getOwnerId', () => {
  it('all writes land under the SUITE_OWNER_ID sentinel', async () => {
    const store = new ModelSettingsStore({
      db,
      envRegistry: {},
      providerCatalog: CATALOG,
      scope: 'global',
    });
    const app = mountGlobal(store);

    const r = await supertest(app)
      .put('/api/model-settings/providers/openai')
      .send({ apiKey: 'sk-suite' });
    expect(r.status).toBe(200);

    const row = db
      .prepare<[], { owner_id: string }>(
        'SELECT owner_id FROM provider_keys',
      )
      .get();
    expect(row?.owner_id).toBe(SUITE_OWNER_ID);
  });

  it('per-user router with no getOwnerId 401s', async () => {
    const store = new ModelSettingsStore({ db, envRegistry: {}, providerCatalog: CATALOG });
    const app = express();
    app.use(express.json());
    app.use('/api/model-settings', createModelSettingsRouter({ store }));
    const r = await supertest(app).get('/api/model-settings/providers');
    expect(r.status).toBe(401);
  });
});
