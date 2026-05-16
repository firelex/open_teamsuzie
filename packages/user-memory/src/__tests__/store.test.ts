import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UserMemoryStore, slugifyUserId } from '../store.js';

function freshStore() {
  const memoryDir = mkdtempSync(path.join(tmpdir(), 'user-memory-'));
  return { store: new UserMemoryStore({ memoryDir }), memoryDir };
}

describe('slugifyUserId', () => {
  it('lowercases + replaces non-alphanumerics with hyphens', () => {
    expect(slugifyUserId('Mathias.Strasser@Blixt.example.com')).toBe('mathias-strasser-blixt-example-com');
  });

  it('collapses runs and strips leading/trailing hyphens', () => {
    expect(slugifyUserId('  --foo___BAR!! ')).toBe('foo-bar');
  });

  it('falls back when input is empty or unslugifiable', () => {
    expect(slugifyUserId('')).toBe('unknown-user');
    expect(slugifyUserId('   ')).toBe('unknown-user');
    expect(slugifyUserId('@@@')).toBe('unknown-user');
  });
});

describe('UserMemoryStore', () => {
  let env: ReturnType<typeof freshStore>;
  beforeEach(() => { env = freshStore(); });

  it('read returns empty string when no file exists', async () => {
    expect(await env.store.read('alice@example.com')).toBe('');
  });

  it('append creates the file on first write with a header', async () => {
    const result = await env.store.append('alice@example.com', 'Firm: Blixt Capital. Preferred currency: EUR.');
    const content = await readFile(result.path, 'utf-8');
    expect(content).toMatch(/^# Memory\n\n## \d{4}-\d{2}-\d{2}T/);
    expect(content).toContain('Firm: Blixt Capital');
  });

  it('append preserves existing content and adds a timestamped entry', async () => {
    await env.store.append('alice@example.com', 'first note');
    await env.store.append('alice@example.com', 'second note');
    const text = await env.store.read('alice@example.com');
    expect(text).toContain('first note');
    expect(text).toContain('second note');
    expect(text.match(/^## /gm)?.length).toBe(2);
  });

  it('isolates per-user', async () => {
    await env.store.append('alice@example.com', 'alice fact');
    await env.store.append('bob@example.com', 'bob fact');
    expect(await env.store.read('alice@example.com')).toContain('alice fact');
    expect(await env.store.read('alice@example.com')).not.toContain('bob fact');
    expect(await env.store.read('bob@example.com')).toContain('bob fact');
  });

  it('replace overwrites the file', async () => {
    await env.store.append('alice@example.com', 'old content');
    await env.store.replace('alice@example.com', '# Fresh start\n');
    expect(await env.store.read('alice@example.com')).toBe('# Fresh start\n');
  });

  it('resolvePath returns the slugified path without writing', async () => {
    const fp = env.store.resolvePath('Alice@Example.com');
    expect(fp).toBe(path.join(env.memoryDir, 'alice-example-com.md'));
    expect(await env.store.read('Alice@Example.com')).toBe(''); // not created
  });
});
