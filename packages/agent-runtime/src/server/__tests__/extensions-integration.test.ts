/**
 * End-to-end test for Task 3.5.6 — extensions wired into createApp.
 *
 * We write a single extension to a temp dir, point createApp at that dir,
 * and verify the extension-provided module is mounted and reachable via
 * HTTP. Proves the registration path runs and that `manifest.modules.*`
 * gates extension modules the same way it gates core modules.
 *
 * Note: the temp-dir extension can't `import express` (Node's module
 * resolver wouldn't find it from outside any package's tree). Instead the
 * extension exports a bare `(req, res, next)` request handler; Express's
 * `app.use(prefix, fn)` accepts any middleware function, so the registry
 * mounts it just like a Router.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'agent-runtime-ext-int-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('extensions integration (createApp + loadExtensions)', () => {
  it('mounts an extension-provided module and serves its routes', async () => {
    // Minimal valid manifest. Enable the extension's module name so the
    // registry mounts it; everything else is off.
    const manifestPath = join(tmp, 'agent.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'Test', description: 'd',
      theme: { id: 'default' },
      persona: { id: 'p', systemPrompt: 's' },
      components: {
        chat: true, toolActivity: true, approvals: false,
        knowledgeBase: false, files: false, citations: false, workspace: false,
      },
      modules: { 'ext-mod': true },
      tools: [],
    }));

    // Write the extension. Plain request-handler function — no `import
    // express` from the temp dir (the resolver wouldn't find it).
    const extensionsDir = join(tmp, 'extensions');
    mkdirSync(join(extensionsDir, 'demo'), { recursive: true });
    writeFileSync(join(extensionsDir, 'demo', 'index.mjs'), `
      const handler = (req, res, next) => {
        if (req.method === 'GET' && req.url === '/ping') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, from: 'extension' }));
          return;
        }
        next();
      };
      export default {
        name: 'demo',
        modules: [{ name: 'ext-mod', apiPrefix: '/api/ext-mod', router: handler }],
      };
    `);

    const { app, close } = await createApp({
      manifestPath,
      dbPath: join(tmp, 'agent.db'),
      extensionsDir,
      devAuth: true,
    });
    try {
      const res = await request(app).get('/api/ext-mod/ping');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, from: 'extension' });
    } finally {
      await close();
    }
  });

  it('does not mount extension routes when their module flag is false', async () => {
    const manifestPath = join(tmp, 'agent.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'Test', description: 'd',
      theme: { id: 'default' },
      persona: { id: 'p', systemPrompt: 's' },
      components: {
        chat: true, toolActivity: true, approvals: false,
        knowledgeBase: false, files: false, citations: false, workspace: false,
      },
      // Note: 'ext-mod' deliberately not enabled.
      modules: {},
      tools: [],
    }));

    const extensionsDir = join(tmp, 'extensions');
    mkdirSync(join(extensionsDir, 'demo'), { recursive: true });
    writeFileSync(join(extensionsDir, 'demo', 'index.mjs'), `
      const handler = (req, res) => res.end('hi');
      export default {
        name: 'demo',
        modules: [{ name: 'ext-mod', apiPrefix: '/api/ext-mod', router: handler }],
      };
    `);

    const { app, close } = await createApp({
      manifestPath,
      dbPath: join(tmp, 'agent.db'),
      extensionsDir,
      devAuth: true,
    });
    try {
      const res = await request(app).get('/api/ext-mod/ping');
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
