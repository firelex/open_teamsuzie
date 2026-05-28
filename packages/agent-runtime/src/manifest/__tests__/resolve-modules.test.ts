import { describe, it, expect } from 'vitest';
import { resolveModules } from '../defaults.js';
import type { AgentManifest } from '../schema.js';

function v2Manifest(
  capabilities: Record<string, boolean>,
  modules?: Record<string, boolean>,
): AgentManifest {
  return {
    schemaVersion: 1,
    name: 'Test',
    description: '',
    theme: { id: 'default' },
    persona: { id: 'p', systemPrompt: '' },
    components: { chat: true, toolActivity: true, approvals: false, knowledgeBase: false, files: false, citations: false, workspace: false },
    tools: [],
    // v2-only fields carried through the manifest store via spread.
    ...({ version: 2, capabilities, modules } as object),
  } as AgentManifest;
}

describe('resolveModules (capabilities-first)', () => {
  it('derives matters/reviews/knowledgeBase from capabilities when modules is absent', () => {
    const m = v2Manifest({
      chat: true, fileUploads: true, docxDrafting: false, redlines: false,
      legalResearch: true, citations: true, matters: true, reviewGrids: true,
      clientSharing: false, approvals: false, workspace: false,
    });
    const resolved = resolveModules(m);
    expect(resolved.matters).toBe(true);
    expect(resolved.reviews).toBe(true);
    expect(resolved.knowledgeBase).toBe(true);
  });

  it('derives drafting/redline from capabilities', () => {
    const m = v2Manifest({
      chat: true, fileUploads: false, docxDrafting: true, redlines: true,
      legalResearch: false, citations: false, matters: false, reviewGrids: false,
      clientSharing: false, approvals: false, workspace: false,
    });
    const resolved = resolveModules(m);
    expect(resolved.drafting).toBe(true);
    expect(resolved.redline).toBe(true);
  });

  it('disables capability-derived modules when capability is false', () => {
    const m = v2Manifest({
      chat: true, fileUploads: false, docxDrafting: false, redlines: false,
      legalResearch: false, citations: false, matters: false, reviewGrids: false,
      clientSharing: false, approvals: false, workspace: false,
    });
    const resolved = resolveModules(m);
    expect(resolved.matters).toBe(false);
    expect(resolved.reviews).toBe(false);
    expect(resolved.knowledgeBase).toBe(false);
    expect(resolved.drafting).toBe(false);
    expect(resolved.redline).toBe(false);
  });

  it('lets explicit manifest.modules override capability-derived values', () => {
    const m = v2Manifest(
      { chat: true, fileUploads: false, docxDrafting: false, redlines: false,
        legalResearch: false, citations: false, matters: false, reviewGrids: false,
        clientSharing: false, approvals: false, workspace: false },
      { matters: true, reviews: true },
    );
    const resolved = resolveModules(m);
    expect(resolved.matters).toBe(true);
    expect(resolved.reviews).toBe(true);
  });

  it('falls back to DEFAULT_MODULES + manifest.modules when capabilities is absent (v1 back-compat)', () => {
    const m: AgentManifest = {
      schemaVersion: 1,
      name: 'V1',
      description: '',
      theme: { id: 'default' },
      persona: { id: 'p', systemPrompt: '' },
      components: { chat: true, toolActivity: true, approvals: false, knowledgeBase: false, files: false, citations: false, workspace: false },
      tools: [],
      modules: { matters: true },
    };
    const resolved = resolveModules(m);
    expect(resolved.matters).toBe(true);
    expect(resolved.reviews).toBe(false); // DEFAULT_MODULES.reviews
    expect(resolved.assistant).toBe(true); // DEFAULT_MODULES.assistant
  });
});
