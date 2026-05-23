import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPreset } from '../index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'preset-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writePreset(name: string, agent: object, extras: Record<string, string> = {}): string {
  const dir = join(tmp, 'presets', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(agent));
  for (const [rel, content] of Object.entries(extras)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

describe('applyPreset', () => {
  it('writes agent.json from the preset into an empty build dir', () => {
    const presetDir = writePreset('p', { name: 'P', modules: { library: true } });
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir);
    applyPreset(buildDir, presetDir);
    const written = JSON.parse(readFileSync(join(buildDir, 'agent.json'), 'utf8'));
    expect(written.name).toBe('P');
    expect(written.modules.library).toBe(true);
  });

  it('existing buildDir agent.json wins on conflict (idempotent overlay)', () => {
    const presetDir = writePreset('p', { name: 'Preset', modules: { library: true } });
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir);
    writeFileSync(join(buildDir, 'agent.json'), JSON.stringify({ name: 'Existing' }));
    applyPreset(buildDir, presetDir);
    const written = JSON.parse(readFileSync(join(buildDir, 'agent.json'), 'utf8'));
    expect(written.name).toBe('Existing');         // build wins
    expect(written.modules.library).toBe(true);    // unconflicted preset field merged
  });

  it('overrides patch on top of preset but under existing build fields', () => {
    const presetDir = writePreset('p', { name: 'P', description: 'P' });
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir);
    writeFileSync(join(buildDir, 'agent.json'), JSON.stringify({ name: 'Existing' }));
    applyPreset(buildDir, presetDir, { description: 'OverrideDesc' });
    const written = JSON.parse(readFileSync(join(buildDir, 'agent.json'), 'utf8'));
    expect(written.name).toBe('Existing');          // build wins over override
    expect(written.description).toBe('OverrideDesc'); // override wins over preset
  });

  it('copies personas/ and workflows.seed.json idempotently', () => {
    const presetDir = writePreset('p', { name: 'P' }, {
      'personas/counsel/PERSONA.md': '---\nid: counsel\n---\nHello',
      'workflows.seed.json': '[]',
    });
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir);
    applyPreset(buildDir, presetDir);
    expect(readFileSync(join(buildDir, 'personas/counsel/PERSONA.md'), 'utf8'))
      .toContain('id: counsel');
    expect(readFileSync(join(buildDir, 'workflows.seed.json'), 'utf8')).toBe('[]');
  });

  it('does not overwrite existing sibling files', () => {
    const presetDir = writePreset('p', { name: 'P' }, {
      'workflows.seed.json': '[]',
    });
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir);
    writeFileSync(join(buildDir, 'workflows.seed.json'), '[{"x":1}]');
    applyPreset(buildDir, presetDir);
    expect(readFileSync(join(buildDir, 'workflows.seed.json'), 'utf8')).toBe('[{"x":1}]');
  });
});
