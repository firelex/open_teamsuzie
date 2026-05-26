import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  snapshotManifest,
  listRevisions,
  readRevision,
  revertToRevision,
  pruneHistory,
} from '../history.js';
import { defaultManifest } from '../defaults.js';

function fresh(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'manifest-history-'));
  writeFileSync(path.join(dir, 'agent.json'), JSON.stringify(defaultManifest(), null, 2) + '\n');
  return dir;
}

describe('manifest history', () => {
  let buildDir: string;
  beforeEach(() => { buildDir = fresh(); });
  afterEach(() => {
    try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('snapshot writes a timestamped file and indexes it', () => {
    const ts = snapshotManifest({ buildDir, label: 'Initial build', sourceKind: 'initial' });
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const snapFile = path.join(buildDir, '.manifest-history', `${ts}.json`);
    expect(existsSync(snapFile)).toBe(true);
    const revs = listRevisions(buildDir);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ ts, label: 'Initial build', sourceKind: 'initial' });
  });

  it('snapshot copies the current agent.json contents at the time of call', () => {
    writeFileSync(path.join(buildDir, 'agent.json'), '{"v":1}');
    const ts = snapshotManifest({ buildDir, label: 'L', sourceKind: 'nl-patch' });
    expect(readFileSync(path.join(buildDir, '.manifest-history', `${ts}.json`), 'utf8')).toBe('{"v":1}');
  });

  it('readRevision returns the snapshot body', () => {
    writeFileSync(path.join(buildDir, 'agent.json'), '{"a":1}');
    const ts = snapshotManifest({ buildDir, label: 'L', sourceKind: 'json-editor' });
    expect(readRevision(buildDir, ts)).toBe('{"a":1}');
  });

  it('revertToRevision writes the snapshot back into agent.json and appends a "Revert to" entry', () => {
    writeFileSync(path.join(buildDir, 'agent.json'), '{"a":1}');
    const tsA = snapshotManifest({ buildDir, label: 'A', sourceKind: 'initial' });
    writeFileSync(path.join(buildDir, 'agent.json'), '{"a":2}');
    revertToRevision({ buildDir, ts: tsA });
    expect(readFileSync(path.join(buildDir, 'agent.json'), 'utf8')).toBe('{"a":1}');
    const revs = listRevisions(buildDir);
    expect(revs.length).toBeGreaterThanOrEqual(2);
    expect(revs[revs.length - 1].sourceKind).toBe('revert');
  });

  it('pruneHistory deletes the oldest snapshots when count exceeds max', () => {
    for (let i = 0; i < 7; i++) {
      writeFileSync(path.join(buildDir, 'agent.json'), `{"i":${i}}`);
      snapshotManifest({ buildDir, label: `s${i}`, sourceKind: 'json-editor' });
    }
    pruneHistory(buildDir, 3);
    const revs = listRevisions(buildDir);
    expect(revs).toHaveLength(3);
    const files = readdirSync(path.join(buildDir, '.manifest-history')).filter((f) => f.endsWith('.json') && f !== 'revisions.json');
    expect(files).toHaveLength(3);
  });
});
