import { describe, it, expect } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { PersonaRegistry } from '../registry.js';
import { PERSONAS_MIGRATIONS } from '../migrations.js';
import { applyPersona } from '../types.js';
import type { Persona } from '../types.js';

function builtin(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'litigation',
    source: 'builtin',
    name: 'Litigation Counsel',
    description: 'trial work',
    systemPrompt: 'Old prompt.',
    allowedTools: ['old_tool'],
    ...overrides,
  };
}

describe('PersonaRegistry.refreshUneditedSeeds', () => {
  it('updates never-edited seeded copies and leaves edited and user-made personas alone', () => {
    const db = openDb({ path: ':memory:', migrations: PERSONAS_MIGRATIONS });
    const before = new PersonaRegistry({ db, inlinePersonas: [builtin()] });
    before.seedFromBuiltinsIfNeeded('alice');
    before.seedFromBuiltinsIfNeeded('bob');
    const bobCopy = before.listForOwner('bob')[0]!;
    before.update(bobCopy.id, 'bob', { systemPrompt: 'Bob edited this.' });
    // Seeding and the edit can land in the same millisecond inside a test.
    db.prepare(`UPDATE personas SET updated_at = created_at + 1 WHERE id = ?`).run(bobCopy.id);
    // Created after seeding, same name as the built-in: must not be touched.
    before.create({ ownerId: 'alice', name: 'Litigation Counsel', description: 'mine', systemPrompt: 'Mine.' });
    db.prepare(`UPDATE personas SET created_at = created_at + 1000, updated_at = updated_at + 1000 WHERE description = 'mine'`).run();

    const after = new PersonaRegistry({
      db,
      inlinePersonas: [builtin({ systemPrompt: 'New prompt.', allowedTools: undefined })],
    });
    expect(after.refreshUneditedSeeds()).toBe(1);

    const alice = after.listForOwner('alice');
    const aliceSeeded = alice.find((p) => p.description === 'trial work')!;
    expect(aliceSeeded.systemPrompt).toBe('New prompt.');
    expect(aliceSeeded.allowedTools ?? null).toBeNull();
    expect(aliceSeeded.updatedAt).toBe(aliceSeeded.createdAt);
    expect(alice.find((p) => p.description === 'mine')!.systemPrompt).toBe('Mine.');
    expect(after.listForOwner('bob')[0]!.systemPrompt).toBe('Bob edited this.');
  });
});

describe('applyPersona personaPromptMode', () => {
  const persona = builtin({ systemPrompt: 'Focus on litigation.', allowedTools: undefined });

  it('replaces the default prompt by default', () => {
    const r = applyPersona({ defaultSystemPrompt: 'Base.', tools: [], persona });
    expect(r.systemPrompt).toBe('Focus on litigation.');
  });

  it('appends the persona after the default prompt in layer mode, then skills', () => {
    const r = applyPersona({
      defaultSystemPrompt: 'Base.',
      skillSystemPrompt: 'Skill.',
      tools: [],
      persona,
      personaPromptMode: 'layer',
    });
    expect(r.systemPrompt).toBe('Base.\n\nFocus on litigation.\n\nSkill.');
  });

  it('uses the default prompt alone when there is no persona in layer mode', () => {
    const r = applyPersona({ defaultSystemPrompt: 'Base.', tools: [], personaPromptMode: 'layer' });
    expect(r.systemPrompt).toBe('Base.');
  });
});
