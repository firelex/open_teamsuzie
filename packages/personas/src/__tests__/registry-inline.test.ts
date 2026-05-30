import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersonaRegistry } from '../registry.js';
import type { Persona } from '../types.js';

function makePersona(id: string, overrides: Partial<Persona> = {}): Persona {
  return {
    id,
    source: 'builtin',
    name: id,
    description: `description for ${id}`,
    systemPrompt: `You are ${id}.`,
    ...overrides,
  };
}

describe('PersonaRegistry inlinePersonas', () => {
  it('exposes inline personas as builtins when no filesystemDir is configured', () => {
    const reg = new PersonaRegistry({
      inlinePersonas: [
        makePersona('antitrust-counsel', { name: 'Antitrust Counsel' }),
        makePersona('case-law-lookup', { name: 'Case Law Lookup' }),
      ],
    });
    const builtins = reg.listBuiltins();
    expect(builtins.map((p) => p.id).sort()).toEqual(['antitrust-counsel', 'case-law-lookup']);
    const ac = builtins.find((p) => p.id === 'antitrust-counsel');
    expect(ac?.name).toBe('Antitrust Counsel');
    expect(ac?.systemPrompt).toContain('You are antitrust-counsel.');
  });

  it('merges filesystem builtins with inline personas', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'persona-inline-'));
    try {
      mkdirSync(path.join(dir, 'litigation'));
      writeFileSync(
        path.join(dir, 'litigation', 'PERSONA.md'),
        '---\nname: Litigation\ndescription: trial work\n---\n\nYou are a litigator.\n',
      );
      const reg = new PersonaRegistry({
        filesystemDir: dir,
        inlinePersonas: [makePersona('antitrust-counsel', { name: 'Antitrust Counsel' })],
      });
      const ids = reg.listBuiltins().map((p) => p.id).sort();
      expect(ids).toEqual(['antitrust-counsel', 'litigation']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filesystem entries win on id collision', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'persona-inline-'));
    try {
      mkdirSync(path.join(dir, 'counsel'));
      writeFileSync(
        path.join(dir, 'counsel', 'PERSONA.md'),
        '---\nname: Filesystem Counsel\ndescription: hand-edited\n---\n\nFilesystem body.\n',
      );
      const reg = new PersonaRegistry({
        filesystemDir: dir,
        inlinePersonas: [
          makePersona('counsel', { name: 'Manifest Counsel', systemPrompt: 'Manifest body.' }),
        ],
      });
      const builtins = reg.listBuiltins();
      expect(builtins).toHaveLength(1);
      expect(builtins[0]!.name).toBe('Filesystem Counsel');
      expect(builtins[0]!.systemPrompt.trim()).toBe('Filesystem body.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles empty inlinePersonas gracefully', () => {
    const reg = new PersonaRegistry({ inlinePersonas: [] });
    expect(reg.listBuiltins()).toHaveLength(0);
  });
});
