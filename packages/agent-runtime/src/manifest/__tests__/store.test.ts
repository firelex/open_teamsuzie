import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MODULES,
  ManifestStore,
  loadManifest,
  resolveModules,
} from '../index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'agent-runtime-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('loadManifest', () => {
  it('returns the default manifest when file is missing', () => {
    const m = loadManifest(join(tmp, 'agent.json'));
    expect(m.schemaVersion).toBe(1);
    expect(m.name).toBe('Agent');
    expect(m.persona.id).toBe('default');
    expect(m.tools).toEqual([]);
  });

  it('returns the default manifest when JSON is malformed', () => {
    const path = join(tmp, 'agent.json');
    writeFileSync(path, '{ not json');
    const m = loadManifest(path);
    expect(m.name).toBe('Agent');
  });

  it('merges partial fields with defaults', () => {
    const path = join(tmp, 'agent.json');
    writeFileSync(path, JSON.stringify({
      name: 'Counsel',
      modules: { library: true },
    }));
    const m = loadManifest(path);
    expect(m.name).toBe('Counsel');
    expect(resolveModules(m).library).toBe(true);
    expect(resolveModules(m).assistant).toBe(true); // inherited
  });

  it('exposes DEFAULT_MODULES with assistant/history/personas/settings on', () => {
    expect(DEFAULT_MODULES.assistant).toBe(true);
    expect(DEFAULT_MODULES.library).toBe(false);
    expect(DEFAULT_MODULES.matters).toBe(false);
  });
});

describe('ManifestStore', () => {
  it('hot-reloads on file change', async () => {
    const path = join(tmp, 'agent.json');
    writeFileSync(path, JSON.stringify({ name: 'A' }));
    const store = new ManifestStore(path);
    try {
      expect(store.get().name).toBe('A');
      const seen: string[] = [];
      const off = store.onChange((m) => seen.push(m.name));

      // Bump mtime + content so watchFile fires.
      await new Promise((r) => setTimeout(r, 1100));
      writeFileSync(path, JSON.stringify({ name: 'B' }));

      // watchFile polls at 1s in our config; allow ~2s.
      await new Promise((r) => setTimeout(r, 2200));
      expect(store.get().name).toBe('B');
      expect(seen).toContain('B');
      off();
    } finally {
      store.close();
    }
  }, 10_000);
});
