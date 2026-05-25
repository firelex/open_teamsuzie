import { describe, it, expect, vi } from 'vitest';
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

  it('warns (but still loads) when an extension has no README.md', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = tmp();
    mkdirSync(path.join(root, 'no-readme'));
    writeFileSync(path.join(root, 'no-readme', 'index.mjs'),
      `export default { name: 'no-readme' };`);
    const exts = await loadExtensions(root);
    expect(exts.map((e) => e.name)).toEqual(['no-readme']);
    const warned = warn.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes("'no-readme'") && args[0].includes('README'),
    );
    expect(warned).toBe(true);
    warn.mockRestore();
  });

  it('does not warn when a README is present', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = tmp();
    mkdirSync(path.join(root, 'with-readme'));
    writeFileSync(path.join(root, 'with-readme', 'index.mjs'),
      `export default { name: 'with-readme' };`);
    writeFileSync(path.join(root, 'with-readme', 'README.md'), '# with-readme\n');
    await loadExtensions(root);
    const warned = warn.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('README'),
    );
    expect(warned).toBe(false);
    warn.mockRestore();
  });

  it('rejects an export missing a name', async () => {
    const root = tmp();
    mkdirSync(path.join(root, 'nameless'));
    writeFileSync(path.join(root, 'nameless', 'index.mjs'), `export default { tools: [] };`);
    await expect(loadExtensions(root)).rejects.toThrow(/missing.*name/i);
  });
});
