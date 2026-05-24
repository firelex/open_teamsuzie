/**
 * End-to-end "defaults vs. user" invariants — Task 1.6 of the omnibus
 * agent-runtime v2 plan.
 *
 * The product rule is JSON-defaults / user-overrides:
 *   1. Prompts declared in `manifest.prompts` (and entries in
 *      `workflows.seed.json`) are copied into the workflows store as
 *      user-owned rows the FIRST time the app boots against a given DB.
 *   2. Any edit the user makes to one of those seeded rows must survive
 *      a fresh `createApp(...)` against the same DB (i.e. an app
 *      restart). The seed must NOT clobber the edit.
 *   3. Any delete the user makes must stay deleted across a restart.
 *      The seed must NOT re-introduce the row.
 *
 * The store-level invariant is already covered by
 * `packages/workflows/src/__tests__/seed-as-user.test.ts`; this test
 * exercises the same invariants through the live Express stack via
 * supertest, so the wiring in `createApp` is what's actually being
 * verified.
 *
 * Owner-id note: `createApp` seeds with a hard-coded
 * `'agent-runtime-default'` owner. The built-in `devAuth` injector
 * synthesises a `'dev@local'` session, which would not match the seed
 * owner and would make seeded rows invisible to the request. We wrap
 * the returned app in a parent Express app that pre-injects a session
 * matching the seed owner; the runtime's `injectDevSession` only sets
 * the session when it's missing, so our pre-injection wins.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { createApp } from '../index.js';

/** Owner id the runtime seeds with — see OWNER_ID in src/server/index.ts. */
const SEED_OWNER = 'agent-runtime-default';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agent-runtime-defaults-vs-user-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeManifest(prompts: Array<{
  title: string;
  subtitle: string;
  prompt?: string;
}>): string {
  const path = join(tmp, 'agent.json');
  writeFileSync(path, JSON.stringify({
    name: 'Test', description: 'd',
    theme: { id: 'default' },
    persona: { id: 'p', systemPrompt: 's' },
    components: {
      chat: true, toolActivity: true, approvals: false,
      knowledgeBase: false, files: false, citations: false, workspace: false,
    },
    modules: { library: true },
    prompts,
    tools: [],
  }));
  return path;
}

/**
 * Wrap the runtime app in a parent that pre-injects a session matching
 * the runtime's hard-coded seed owner. The runtime's `injectDevSession`
 * is a no-op when `req.session` is already set, so the seeded rows are
 * visible to the request.
 */
function makeAppWithSeedOwnerSession(manifestPath: string, dbPath: string): {
  wrapper: Express;
  close: () => Promise<void>;
} {
  const handles = createApp({ manifestPath, dbPath, devAuth: true });
  const wrapper = express();
  wrapper.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = {
      user: { email: SEED_OWNER },
    };
    next();
  });
  wrapper.use(handles.app);
  return { wrapper, close: handles.close };
}

describe('defaults-vs-user (end-to-end)', () => {
  it('preserves user edits to a seeded prompt across an app restart', async () => {
    const manifestPath = writeManifest([
      { title: 'Hello', subtitle: 's', prompt: 'world' },
    ]);
    writeFileSync(join(tmp, 'workflows.seed.json'), '[]');
    const dbPath = join(tmp, 'agent.db');

    // Boot #1 — seed runs, user edits the seeded prompt.
    const boot1 = makeAppWithSeedOwnerSession(manifestPath, dbPath);
    try {
      let res = await request(boot1.wrapper).get('/api/workflows');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].prompt).toBe('world');
      const id = res.body.items[0].id as string;

      res = await request(boot1.wrapper)
        .patch(`/api/workflows/${id}`)
        .send({ prompt: 'edited' });
      expect(res.status).toBe(200);
      expect(res.body.item.prompt).toBe('edited');
    } finally {
      await boot1.close();
    }

    // Boot #2 — new app instance, same DB. The seed must not clobber.
    const boot2 = makeAppWithSeedOwnerSession(manifestPath, dbPath);
    try {
      const res = await request(boot2.wrapper).get('/api/workflows');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].prompt).toBe('edited');
    } finally {
      await boot2.close();
    }
  });

  it('keeps a deleted seeded prompt deleted across an app restart', async () => {
    const manifestPath = writeManifest([
      { title: 'Hello',   subtitle: 's', prompt: 'world' },
      { title: 'Goodbye', subtitle: 's', prompt: 'bye'   },
    ]);
    writeFileSync(join(tmp, 'workflows.seed.json'), '[]');
    const dbPath = join(tmp, 'agent.db');

    // Boot #1 — seed runs, user deletes one of the two seeded prompts.
    const boot1 = makeAppWithSeedOwnerSession(manifestPath, dbPath);
    try {
      let res = await request(boot1.wrapper).get('/api/workflows');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      const idToDelete = res.body.items[0].id as string;

      res = await request(boot1.wrapper).delete(`/api/workflows/${idToDelete}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      res = await request(boot1.wrapper).get('/api/workflows');
      expect(res.body.items).toHaveLength(1);
    } finally {
      await boot1.close();
    }

    // Boot #2 — new app instance, same DB. The seed must not re-introduce
    // the deleted row.
    const boot2 = makeAppWithSeedOwnerSession(manifestPath, dbPath);
    try {
      const res = await request(boot2.wrapper).get('/api/workflows');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    } finally {
      await boot2.close();
    }
  });
});
