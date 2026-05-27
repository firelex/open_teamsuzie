import { describe, it, expect, vi } from 'vitest';
import { loadManifestV2 as loadManifest } from '../load.js';

const baseFields = {
  description: 'desc',
  persona: { id: 'default', systemPrompt: 'x' },
  ai: { model: 'x' },
  tools: [],
  theme: { id: 'default' },
  modules: { chat: true },
  components: { chat: true },
};

const v1Manifest = {
  schemaVersion: 1 as const,
  name: 'Old App',
  ...baseFields,
};

const v2Manifest = {
  version: 2 as const,
  brand: { name: 'New App' },
  ...baseFields,
};

describe('loadManifest', () => {
  it('returns v2 untouched when input is v2', () => {
    const out = loadManifest(v2Manifest);
    expect(out.version).toBe(2);
    expect(out.brand.name).toBe('New App');
  });

  it('migrates v1 (schemaVersion: 1) to v2', () => {
    const out = loadManifest(v1Manifest);
    expect(out.version).toBe(2);
    expect(out.brand.name).toBe('Old App');
  });

  it('migrates v1 (no version field) to v2', () => {
    const { schemaVersion, ...withoutVersion } = v1Manifest;
    const out = loadManifest(withoutVersion);
    expect(out.brand.name).toBe('Old App');
  });

  it('logs a one-line migration notice for v1 inputs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    loadManifest(v1Manifest);
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/Migrated v1 → v2/));
    spy.mockRestore();
  });

  it('does not log for v2 inputs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    loadManifest(v2Manifest);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('throws on unknown version', () => {
    expect(() => loadManifest({ ...v1Manifest, schemaVersion: 99 })).toThrow(/Unknown manifest version/);
  });
});
