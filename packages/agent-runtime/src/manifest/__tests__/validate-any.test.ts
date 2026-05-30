import { describe, it, expect } from 'vitest';
import { validateManifestAny } from '../validate.js';

const validV2 = {
  version: 2,
  brand: { name: 'Test', shortName: 'test' },
  home: { starterPrompts: [], disclaimerPlacement: 'footer' },
  legal: { jurisdictions: [], disclaimer: '', clientFacing: false, requireHumanReviewFor: [], forbid: [] },
  capabilities: {
    chat: true, fileUploads: false, docxDrafting: false, redlines: false,
    legalResearch: false, citations: false, matters: false, reviewGrids: false,
    clientSharing: false, approvals: false, workspace: false,
  },
  navigation: { items: [{ id: 'assistant', label: 'Assistant', visible: true }] },
  audience: { mode: 'solo_builder', requiresLogin: true, clientSafeMode: false, allowAnonymousPreview: false },
  description: 'test',
  theme: { id: 'default' },
  persona: { id: 'p', systemPrompt: '' },
  components: { chat: true, toolActivity: true, approvals: false, knowledgeBase: false, files: false, citations: false, workspace: false },
  tools: [],
};

const validV1 = {
  schemaVersion: 1,
  name: 'Test V1',
  description: 'legacy v1 manifest',
  theme: { id: 'default' },
  persona: { id: 'p', systemPrompt: '' },
  components: { chat: true, toolActivity: true, approvals: false, knowledgeBase: false, files: false, citations: false, workspace: false },
  tools: [],
};

describe('validateManifestAny', () => {
  it('accepts a valid v2 manifest', () => {
    const r = validateManifestAny(validV2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe(2);
  });

  it('accepts a valid v1 manifest', () => {
    const r = validateManifestAny(validV1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe(1);
  });

  it('returns errors when both validations fail', () => {
    const r = validateManifestAny({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
});
