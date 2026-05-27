import { describe, it, expect } from 'vitest';
import { migrateV1ToV2 } from '../migrate.js';

const v1Base = {
  schemaVersion: 1 as const,
  name: 'Blixt Counsel',
  description: 'Employment law assistant',
  persona: { id: 'default', systemPrompt: 'You are an assistant.' },
  ai: { model: 'claude-sonnet-4-6' },
  tools: [],
  theme: { id: 'default' },
  modules: { chat: true, files: true },
  components: { chat: true, files: true },
};

describe('migrateV1ToV2', () => {
  it('maps v1.name to brand.name', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.brand.name).toBe('Blixt Counsel');
  });

  it('defaults brand.shortName to brand.name', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.brand.shortName).toBe('Blixt Counsel');
  });

  it('stamps version: 2 and drops schemaVersion', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.version).toBe(2);
    expect((v2 as unknown as { schemaVersion?: number }).schemaVersion).toBeUndefined();
  });

  it('does not retain legacy top-level name', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect((v2 as unknown as { name?: string }).name).toBeUndefined();
  });

  it('renames v1.personas to v2.extraPersonas', () => {
    const v1WithPersonas = {
      ...v1Base,
      personas: [{ id: 'extra', systemPrompt: 'You are extra.' }],
    };
    const v2 = migrateV1ToV2(v1WithPersonas);
    expect(v2.extraPersonas).toEqual([{ id: 'extra', systemPrompt: 'You are extra.' }]);
    expect((v2 as unknown as { personas?: unknown[] }).personas).toBeUndefined();
  });

  it('omits extraPersonas when v1 had no personas', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.extraPersonas).toBeUndefined();
  });

  it('carries forward description, persona, ai, tools, theme, modules, components verbatim', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.description).toBe(v1Base.description);
    expect(v2.persona).toEqual(v1Base.persona);
    expect(v2.ai).toEqual(v1Base.ai);
    expect(v2.tools).toEqual(v1Base.tools);
    expect(v2.theme).toEqual(v1Base.theme);
    expect(v2.modules).toEqual(v1Base.modules);
    expect(v2.components).toEqual(v1Base.components);
  });

  it('carries forward optional v1 fields (prompts, source, reviews, matters) when present', () => {
    const v1WithOptionals = {
      ...v1Base,
      prompts: [{ id: 'p1', label: 'Test', body: 'hello' }],
      source: { builder: 'suziecode', builderVersion: '0.1.0' },
      reviews: { templates: [] },
      matters: { types: [] },
    };
    const v2 = migrateV1ToV2(v1WithOptionals);
    expect(v2.prompts).toEqual(v1WithOptionals.prompts);
    expect(v2.source).toEqual(v1WithOptionals.source);
    expect(v2.reviews).toEqual(v1WithOptionals.reviews);
    expect(v2.matters).toEqual(v1WithOptionals.matters);
  });

  it('falls back to empty brand.name when v1.name missing', () => {
    const { name, ...withoutName } = v1Base;
    const v2 = migrateV1ToV2(withoutName as never);
    expect(v2.brand.name).toBe('');
    expect(v2.brand.shortName).toBeUndefined();
  });

  it('defaults home block when v1 has none', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.home).toEqual({
      starterPrompts: [],
      disclaimerPlacement: 'footer',
    });
  });

  it('leaves welcomeMessage undefined so the runtime renders its default greeting', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.home.welcomeMessage).toBeUndefined();
  });

  it('defaults legal block when v1 has none', () => {
    const v2 = migrateV1ToV2(v1Base);
    expect(v2.legal).toEqual({
      jurisdictions: [],
      disclaimer: '',
      clientFacing: false,
      requireHumanReviewFor: [],
      forbid: [],
    });
  });
});
