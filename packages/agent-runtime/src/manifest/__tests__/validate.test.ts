import { describe, it, expect } from 'vitest';
import { validateManifest } from '../validate.js';
import { defaultManifest } from '../defaults.js';

describe('validateManifest', () => {
  it('accepts a default manifest', () => {
    const result = validateManifest(defaultManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schemaVersion).toBe(1);
    }
  });

  it('rejects a manifest missing required fields', () => {
    const bad = { schemaVersion: 1, name: 'x' }; // missing description, theme, persona, components, tools
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toMatch(/persona|theme|components|tools/);
    }
  });

  it('rejects a non-1 schemaVersion', () => {
    const bad = { ...defaultManifest(), schemaVersion: 2 };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects a manifest with a tool whose status is not stub|implemented', () => {
    const m = { ...defaultManifest(), tools: [{ name: 'x', description: 'y', status: 'todo', enabled: true }] };
    const result = validateManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/status/);
    }
  });
});
