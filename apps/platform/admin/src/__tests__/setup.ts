import 'reflect-metadata';
import { Client } from 'pg';
import supertest from 'supertest';
import type { SharedAuthConfig } from '@teamsuzie/shared-auth';
import { createApp, type AdminApp } from '../app.js';
import type { config as ProductionConfig } from '../config.js';

const TEST_DB = process.env.TEST_POSTGRES_DB || 'teamsuzie_test';
const BASE_POSTGRES_URI =
  process.env.TEST_POSTGRES_BASE_URI || 'postgres://teamsuzie:teamsuzie@localhost:5432';

async function ensureTestDatabase(): Promise<string> {
  const metaClient = new Client({ connectionString: `${BASE_POSTGRES_URI}/postgres` });
  await metaClient.connect();
  try {
    const exists = await metaClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (exists.rowCount === 0) {
      await metaClient.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await metaClient.end();
  }

  const dbClient = new Client({ connectionString: `${BASE_POSTGRES_URI}/${TEST_DB}` });
  await dbClient.connect();
  try {
    // Drop every table so each test run starts clean; faster than
    // issuing per-file truncate for the full model set.
    await dbClient.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await dbClient.query('GRANT ALL ON SCHEMA public TO teamsuzie');
    await dbClient.query('GRANT ALL ON SCHEMA public TO public');
  } finally {
    await dbClient.end();
  }

  return `${BASE_POSTGRES_URI}/${TEST_DB}`;
}

function buildTestConfig(): { config: typeof ProductionConfig; sharedAuthConfig: SharedAuthConfig } {
  // Label the env 'development' rather than 'test' so SessionService doesn't
  // set secure:true on cookies (supertest speaks plain HTTP). Semantically
  // the runtime posture matches — no HTTPS, seed runs, CSRF lax.
  const nodeEnv = 'development';
  const config = {
    port: 0,
    publicUrl: 'http://localhost:0',
    allowedOrigin: 'http://localhost:0',
    title: 'Team Suzie Admin (test)',
    nodeEnv,
    agents: [],
    demo: {
      email: 'demo@example.com',
      password: 'demo12345',
      name: 'Demo User',
    },
    seed: {
      email: 'admin@example.com',
      password: 'admin12345',
      name: 'Test Admin',
    },
    configSecret: 'test-only-config-secret',
  } as typeof ProductionConfig;

  const sharedAuthConfig: SharedAuthConfig = {
    node_env: nodeEnv,
    redis: {
      uri: process.env.TEST_REDIS_URI || 'redis://localhost:6379/1',
      key_prefix: `admin-test-${process.pid}`,
    },
    postgres: {
      uri: '', // filled in by setupTestApp
      logging: false,
    },
    cookie: {
      name: `admin-test.sid-${process.pid}`,
      secret: 'test-only-cookie-secret',
      domain: undefined,
      maxAge: 60 * 60 * 1000,
    },
    csrf: {
      cookie_name: 'TEST-CSRF-TOKEN',
    },
    default_user_id: '00000000-0000-0000-0000-000000000000',
  };

  return { config, sharedAuthConfig };
}

export interface TestApp extends AdminApp {
  request: supertest.Agent;
  /** Log in as the seeded admin user and return a supertest agent with the session cookie. */
  loginAsAdmin: () => Promise<supertest.Agent>;
  /** Log in as the seeded demo user. */
  loginAsDemo: () => Promise<supertest.Agent>;
}

/**
 * Build a fresh admin Express app against a clean test database. Call once
 * per test file in `beforeAll`, and `close()` in `afterAll`.
 */
export async function setupTestApp(): Promise<TestApp> {
  const uri = await ensureTestDatabase();
  const { config, sharedAuthConfig } = buildTestConfig();
  sharedAuthConfig.postgres.uri = uri;

  const admin = await createApp({
    config,
    sharedAuthConfig,
    // runSeed stays on so admin + demo users exist for auth tests.
    runSeed: true,
    runConfigSeed: true,
    // supertest doesn't do the CSRF cookie → header dance the SPA does;
    // tests rely on the session cookie alone. CSRF stays on in dev + prod.
    enableCsrf: false,
  });

  const request = supertest.agent(admin.app);

  async function loginAs(email: string, password: string): Promise<supertest.Agent> {
    const agent = supertest.agent(admin.app);
    const response = await agent
      .post('/api/auth/login')
      .send({ email, password })
      .set('Content-Type', 'application/json');
    if (response.status !== 200) {
      throw new Error(`Login failed for ${email}: ${response.status} ${response.text}`);
    }
    return agent;
  }

  return {
    ...admin,
    request,
    loginAsAdmin: () => loginAs(config.seed.email, config.seed.password),
    loginAsDemo: () => loginAs(config.demo.email, config.demo.password),
  };
}
