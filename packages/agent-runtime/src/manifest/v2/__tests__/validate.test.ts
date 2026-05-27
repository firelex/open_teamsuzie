import { describe, it, expect } from 'vitest';
import { validateManifestV2 } from '../validate.js';

const baseValid = {
  version: 2 as const,
  brand: { name: 'Blixt Counsel' },
  home: { starterPrompts: [] as string[], disclaimerPlacement: 'footer' as const },
  description: 'Employment law assistant',
  persona: { id: 'default', systemPrompt: 'You are an assistant.' },
  ai: { model: 'claude-sonnet-4-6' },
  tools: [],
  theme: { id: 'default' },
  modules: { chat: true },
  components: { chat: true },
};

describe('validateManifestV2', () => {
  it('accepts a minimal valid v2 manifest', () => {
    const result = validateManifestV2(baseValid);
    expect(result.brand.name).toBe('Blixt Counsel');
  });

  it('rejects missing brand.name', () => {
    expect(() => validateManifestV2({ ...baseValid, brand: {} })).toThrow();
  });

  it('rejects version !== 2', () => {
    expect(() => validateManifestV2({ ...baseValid, version: 1 })).toThrow();
  });

  it('rejects missing description', () => {
    const { description, ...withoutDescription } = baseValid;
    expect(() => validateManifestV2(withoutDescription)).toThrow();
  });

  it('accepts brand.logo with text type', () => {
    const m = {
      ...baseValid,
      brand: { name: 'X', logo: { type: 'text' as const, wordmark: 'X' } },
    };
    expect(validateManifestV2(m).brand.logo).toEqual({ type: 'text', wordmark: 'X' });
  });

  it('accepts brand.logo with asset type', () => {
    const m = {
      ...baseValid,
      brand: { name: 'X', logo: { type: 'asset' as const, assetId: 'abc.png' } },
    };
    expect(validateManifestV2(m).brand.logo).toEqual({ type: 'asset', assetId: 'abc.png' });
  });

  it('rejects brand.logo with unknown type', () => {
    const m = {
      ...baseValid,
      brand: { name: 'X', logo: { type: 'url', src: 'http://x' } },
    };
    expect(() => validateManifestV2(m as never)).toThrow();
  });

  it('accepts a manifest without optional fields (ai, modules, prompts, source, etc.)', () => {
    const { ai, modules, ...minimal } = baseValid;
    expect(() => validateManifestV2(minimal)).not.toThrow();
  });

  it('rejects missing home', () => {
    const { home, ...withoutHome } = baseValid;
    expect(() => validateManifestV2(withoutHome)).toThrow();
  });

  it('rejects unknown disclaimerPlacement', () => {
    const m = { ...baseValid, home: { starterPrompts: [], disclaimerPlacement: 'sidebar' } };
    expect(() => validateManifestV2(m as never)).toThrow();
  });

  it('accepts home with headline, subheadline, welcomeMessage, starterPrompts', () => {
    const m = {
      ...baseValid,
      home: {
        headline: 'Hi',
        subheadline: 'Welcome',
        welcomeMessage: 'Tell me about your case.',
        starterPrompts: ['summarize_policy', 'draft_hr_email'],
        disclaimerPlacement: 'prominent' as const,
      },
    };
    expect(validateManifestV2(m).home.starterPrompts).toEqual(['summarize_policy', 'draft_hr_email']);
  });
});
