import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'start-agent-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeManifest(modules: Record<string, boolean>): string {
  const path = join(tmp, 'agent.json');
  writeFileSync(path, JSON.stringify({
    name: 'Test', description: 'd',
    theme: { id: 'default' },
    persona: { id: 'p', systemPrompt: 's' },
    components: {
      chat: true, toolActivity: true, approvals: false,
      knowledgeBase: false, files: false, citations: false, workspace: false,
    },
    modules,
    tools: [],
  }));
  return path;
}

describe('createApp (startAgent core)', () => {
  it('mounts /api/manifest always', async () => {
    const { app, close } = createApp({
      manifestPath: writeManifest({}),
      dbPath: join(tmp, 'agent.db'),
      devAuth: true,
    });
    try {
      const res = await request(app).get('/api/manifest');
      expect(res.status).toBe(200);
      expect(res.body.manifest.name).toBe('Test');
    } finally { await close(); }
  });

  it('mounts /api/workflows when modules.library=true', async () => {
    const { app, close } = createApp({
      manifestPath: writeManifest({ library: true }),
      dbPath: join(tmp, 'agent.db'),
      devAuth: true,
    });
    try {
      const res = await request(app).get('/api/workflows');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    } finally { await close(); }
  });

  it('returns 404 for /api/workflows when modules.library=false', async () => {
    const { app, close } = createApp({
      manifestPath: writeManifest({ library: false }),
      dbPath: join(tmp, 'agent.db'),
      devAuth: true,
    });
    try {
      const res = await request(app).get('/api/workflows');
      expect(res.status).toBe(404);
    } finally { await close(); }
  });

  it('mounts /api/personas always (default module on)', async () => {
    const { app, close } = createApp({
      manifestPath: writeManifest({}),
      dbPath: join(tmp, 'agent.db'),
      devAuth: true,
    });
    try {
      const res = await request(app).get('/api/personas');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    } finally { await close(); }
  });
});
