import { describe, expect, it } from 'vitest';
import { resolveMattersLabel, DEFAULT_MATTERS_LABEL } from '../index.js';
import type { AgentManifest } from '../index.js';
import { defaultManifest } from '../index.js';

describe('resolveMattersLabel', () => {
  it('falls back to "Matter" / "Matters" when manifest.matters is absent', () => {
    const m = defaultManifest();
    expect(resolveMattersLabel(m)).toEqual(DEFAULT_MATTERS_LABEL);
    expect(DEFAULT_MATTERS_LABEL).toEqual({ singular: 'Matter', plural: 'Matters' });
  });

  it('uses manifest.matters.label.singular and .plural when both set', () => {
    const m: AgentManifest = {
      ...defaultManifest(),
      matters: { label: { singular: 'Deal', plural: 'Deals' } },
    };
    expect(resolveMattersLabel(m)).toEqual({ singular: 'Deal', plural: 'Deals' });
  });

  it('fills in the missing half when only one of singular/plural is set', () => {
    const m: AgentManifest = {
      ...defaultManifest(),
      matters: { label: { singular: 'Case' } },
    };
    // No naive pluralisation — when plural is missing, fall back to default
    // ("Matters") so the build gets predictable copy rather than guessed.
    expect(resolveMattersLabel(m)).toEqual({ singular: 'Case', plural: 'Matters' });

    const n: AgentManifest = {
      ...defaultManifest(),
      matters: { label: { plural: 'Cases' } },
    };
    expect(resolveMattersLabel(n)).toEqual({ singular: 'Matter', plural: 'Cases' });
  });

  it('ignores empty strings', () => {
    const m: AgentManifest = {
      ...defaultManifest(),
      matters: { label: { singular: '   ', plural: '' } },
    };
    expect(resolveMattersLabel(m)).toEqual(DEFAULT_MATTERS_LABEL);
  });
});
