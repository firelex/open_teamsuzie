import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadExtensions } from '../loader.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'ext-loader-'));

describe('loadExtensions', () => {
  it('returns [] when dir does not exist', async () => {
    expect(await loadExtensions('/no/such/dir')).toEqual([]);
  });

  it('loads every extensions/<name>/index.{mjs,js,ts}', async () => {
    const root = tmp();
    mkdirSync(path.join(root, 'ext-a'));
    writeFileSync(path.join(root, 'ext-a', 'index.mjs'),
      `export default { name: 'ext-a', tools: [{ name: 't1', description: '', execute: async () => '' }] };`);
    mkdirSync(path.join(root, 'ext-b'));
    writeFileSync(path.join(root, 'ext-b', 'index.mjs'),
      `export default { name: 'ext-b' };`);
    const exts = await loadExtensions(root);
    expect(exts.map(e => e.name).sort()).toEqual(['ext-a', 'ext-b']);
    expect(exts.find(e => e.name === 'ext-a')?.tools?.length).toBe(1);
  });

  it('skips a directory without an index file (warn, no throw)', async () => {
    const root = tmp();
    mkdirSync(path.join(root, 'broken'));
    expect(await loadExtensions(root)).toEqual([]);
  });

  it('rejects an export missing a name', async () => {
    const root = tmp();
    mkdirSync(path.join(root, 'nameless'));
    writeFileSync(path.join(root, 'nameless', 'index.mjs'), `export default { tools: [] };`);
    await expect(loadExtensions(root)).rejects.toThrow(/missing.*name/i);
  });
});
