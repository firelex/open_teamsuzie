import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyAnchorPatches,
  applyAndPersistPatches,
} from '../patch.js';
import { defaultManifest } from '../defaults.js';

describe('applyAnchorPatches', () => {
  it('replaces a single unique anchor', () => {
    const out = applyAnchorPatches('hello world', [{ anchor: 'world', replacement: 'there' }]);
    expect(out.result).toBe('hello there');
    expect(out.applied).toHaveLength(1);
    expect(out.rejected).toHaveLength(0);
  });

  it('applies patches sequentially against the running buffer', () => {
    const out = applyAnchorPatches('a-b-c', [
      { anchor: 'a', replacement: 'X' },
      { anchor: 'X-b', replacement: 'Y' },
    ]);
    expect(out.result).toBe('Y-c');
    expect(out.applied).toHaveLength(2);
  });

  it('rejects a missing anchor', () => {
    const out = applyAnchorPatches('abc', [{ anchor: 'zzz', replacement: 'X' }]);
    expect(out.result).toBe('abc');
    expect(out.rejected).toEqual([{ anchor: 'zzz', reason: 'not found' }]);
  });

  it('rejects a non-unique anchor', () => {
    const out = applyAnchorPatches('aa bb aa', [{ anchor: 'aa', replacement: 'XX' }]);
    expect(out.result).toBe('aa bb aa');
    expect(out.rejected).toEqual([{ anchor: 'aa', reason: 'not unique' }]);
  });

  it('continues after a rejection', () => {
    const out = applyAnchorPatches('one two', [
      { anchor: 'zzz', replacement: 'X' },
      { anchor: 'two', replacement: 'three' },
    ]);
    expect(out.result).toBe('one three');
    expect(out.applied).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
  });

  it('treats an empty anchor as not unique', () => {
    const out = applyAnchorPatches('xyz', [{ anchor: '', replacement: 'X' }]);
    expect(out.result).toBe('xyz');
    expect(out.rejected).toEqual([{ anchor: '', reason: 'not unique' }]);
  });
});

describe('applyAndPersistPatches', () => {
  let buildDir: string;
  beforeEach(() => {
    buildDir = mkdtempSync(path.join(tmpdir(), 'patch-persist-'));
    writeFileSync(path.join(buildDir, 'agent.json'), JSON.stringify(defaultManifest(), null, 2) + '\n');
  });
  afterEach(() => {
    try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('writes the new manifest and snapshots the prior one on success', () => {
    const before = readFileSync(path.join(buildDir, 'agent.json'), 'utf8');
    const result = applyAndPersistPatches({
      buildDir,
      patches: [{ anchor: '"name": "Agent"', replacement: '"name": "Renamed"' }],
      label: 'rename',
      sourceKind: 'nl-patch',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe('Renamed');
      const after = readFileSync(path.join(buildDir, 'agent.json'), 'utf8');
      expect(after).not.toBe(before);
      expect(existsSync(path.join(buildDir, '.manifest-history'))).toBe(true);
    }
  });

  it('does NOT write or snapshot when the post-patch JSON is invalid', () => {
    const before = readFileSync(path.join(buildDir, 'agent.json'), 'utf8');
    const result = applyAndPersistPatches({
      buildDir,
      patches: [{ anchor: '"name": "Agent"', replacement: '"name": Agent' }],
      label: 'breakit',
      sourceKind: 'nl-patch',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/parse|json/i);
    }
    const after = readFileSync(path.join(buildDir, 'agent.json'), 'utf8');
    expect(after).toBe(before);
    expect(existsSync(path.join(buildDir, '.manifest-history'))).toBe(false);
  });

  it('does NOT write or snapshot when schema validation fails', () => {
    const before = readFileSync(path.join(buildDir, 'agent.json'), 'utf8');
    const result = applyAndPersistPatches({
      buildDir,
      patches: [{ anchor: '"schemaVersion": 1', replacement: '"schemaVersion": 2' }],
      label: 'bumpversion',
      sourceKind: 'nl-patch',
    });
    expect(result.ok).toBe(false);
    const after = readFileSync(path.join(buildDir, 'agent.json'), 'utf8');
    expect(after).toBe(before);
    expect(existsSync(path.join(buildDir, '.manifest-history'))).toBe(false);
  });
});
