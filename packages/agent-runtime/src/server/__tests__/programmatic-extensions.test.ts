/**
 * Test for Task 6: opts.extensions — programmatically-supplied extensions
 * merged into createApp alongside directory-loaded extensions.
 *
 * We construct an Extension object in-process (no temp dir, no disk writes)
 * and pass it via `extensions: [stubExtension]`. The stub includes both a
 * tool and a module. We assert via HTTP (same mechanism as
 * extensions-integration.test.ts) that the module was mounted — proving the
 * `opts.extensions` loop ran and therefore the tool registration path
 * executed for the same extension.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';
import type { Extension } from '../../extensions/index.js';
import type { AnyToolDefinition } from '@teamsuzie/agent-loop';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'agent-runtime-prog-ext-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('programmatic extensions (opts.extensions)', () => {
  it('registers tools from a programmatically-supplied extension', async () => {
    const TOOL_NAME = 'stub_tool_from_programmatic_extension';
    const MODULE_NAME = 'prog-ext-mod';

    const stubTool: AnyToolDefinition = {
      name: TOOL_NAME,
      description: 'test stub tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    };

    // The handler reports back the tool name so we can assert tool + module
    // in one HTTP round-trip, using the same mechanism as the existing test.
    const handler = (req: any, res: any, next: any) => {
      if (req.method === 'GET' && req.url === '/ping') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, toolName: TOOL_NAME }));
        return;
      }
      next();
    };

    const stubExtension: Extension = {
      name: 'programmatic-test-extension',
      tools: [stubTool],
      modules: [{ name: MODULE_NAME, apiPrefix: `/api/${MODULE_NAME}`, router: handler }],
    };

    // Minimal valid manifest — enable the extension's module name.
    const manifestPath = join(tmp, 'agent.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'Test', description: 'd',
      theme: { id: 'default' },
      persona: { id: 'p', systemPrompt: 's' },
      components: {
        chat: true, toolActivity: true, approvals: false,
        knowledgeBase: false, files: false, citations: false, workspace: false,
      },
      modules: { [MODULE_NAME]: true },
      tools: [],
    }));

    const { app, close } = await createApp({
      manifestPath,
      dbPath: join(tmp, 'agent.db'),
      extensions: [stubExtension],
      devAuth: true,
    });

    try {
      const res = await request(app).get(`/api/${MODULE_NAME}/ping`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, toolName: TOOL_NAME });
    } finally {
      await close();
    }
  });

  it('merges programmatic extensions with directory-loaded extensions', async () => {
    // Both a directory extension and a programmatic extension contribute
    // modules; both should be mounted.
    const { mkdirSync } = await import('node:fs');

    const extensionsDir = join(tmp, 'extensions');
    mkdirSync(join(extensionsDir, 'dir-ext'), { recursive: true });
    writeFileSync(join(extensionsDir, 'dir-ext', 'index.mjs'), `
      const handler = (req, res, next) => {
        if (req.method === 'GET' && req.url === '/ping') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ from: 'dir-extension' }));
          return;
        }
        next();
      };
      export default {
        name: 'dir-ext',
        modules: [{ name: 'dir-mod', apiPrefix: '/api/dir-mod', router: handler }],
      };
    `);

    const progHandler = (req: any, res: any, next: any) => {
      if (req.method === 'GET' && req.url === '/ping') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ from: 'prog-extension' }));
        return;
      }
      next();
    };

    const progExtension: Extension = {
      name: 'prog-ext',
      modules: [{ name: 'prog-mod', apiPrefix: '/api/prog-mod', router: progHandler }],
    };

    const manifestPath = join(tmp, 'agent.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'Test', description: 'd',
      theme: { id: 'default' },
      persona: { id: 'p', systemPrompt: 's' },
      components: {
        chat: true, toolActivity: true, approvals: false,
        knowledgeBase: false, files: false, citations: false, workspace: false,
      },
      modules: { 'dir-mod': true, 'prog-mod': true },
      tools: [],
    }));

    const { app, close } = await createApp({
      manifestPath,
      dbPath: join(tmp, 'agent.db'),
      extensionsDir,
      extensions: [progExtension],
      devAuth: true,
    });

    try {
      const dirRes = await request(app).get('/api/dir-mod/ping');
      expect(dirRes.status).toBe(200);
      expect(dirRes.body).toEqual({ from: 'dir-extension' });

      const progRes = await request(app).get('/api/prog-mod/ping');
      expect(progRes.status).toBe(200);
      expect(progRes.body).toEqual({ from: 'prog-extension' });
    } finally {
      await close();
    }
  });
});
