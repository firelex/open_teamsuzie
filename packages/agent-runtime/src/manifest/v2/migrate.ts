import type { AgentManifest } from '../schema.js';
import type { AgentManifestV2 } from './schema.js';

/**
 * Migrate a v1 manifest (no version field, `schemaVersion: 1`, or
 * partial-shape) to v2.
 *
 * Plan 01 applies three deliberate transforms:
 *   - `schemaVersion: 1` → `version: 2`
 *   - `name: string` → `brand: { name, shortName: name }`
 *   - `personas?` → `extraPersonas?`
 *
 * Every other v1 field carries forward verbatim with matching
 * optionality. Subsequent plans extend this function with mappings
 * for modules/components/etc. as those surfaces are introduced.
 */
export function migrateV1ToV2(
  v1: Partial<AgentManifest> & {
    schemaVersion?: number;
    name?: string;
    personas?: AgentManifest['personas'];
  },
): AgentManifestV2 {
  const name = v1.name ?? '';
  return {
    version: 2,
    brand: {
      name,
      shortName: name || undefined,
    },
    home: {
      starterPrompts: [],
      disclaimerPlacement: 'footer' as const,
    },
    legal: {
      jurisdictions: [],
      disclaimer: '',
      clientFacing: false,
      requireHumanReviewFor: [],
      forbid: [],
    },
    capabilities: (() => {
      const mods = (v1.modules ?? {}) as Record<string, unknown>;
      const comps = (v1.components ?? {}) as Record<string, unknown>;
      const or = (a: unknown, b: unknown) => Boolean(a) || Boolean(b);
      return {
        chat: true,
        fileUploads: or(mods.files, comps.files),
        docxDrafting: false,
        redlines: false,
        legalResearch: or(mods.knowledgeBase, comps.knowledgeBase),
        citations: or(mods.citations, comps.citations),
        matters: Boolean(mods.matters),
        reviewGrids: or(mods.workspace, comps.workspace),
        clientSharing: false,
        approvals: or(mods.approvals, comps.approvals),
        workspace: or(mods.workspace, comps.workspace),
      };
    })(),
    description: v1.description as string,
    theme: v1.theme as AgentManifestV2['theme'],
    persona: v1.persona as AgentManifestV2['persona'],
    extraPersonas: v1.personas as AgentManifestV2['extraPersonas'],
    components: v1.components as AgentManifestV2['components'],
    modules: v1.modules as AgentManifestV2['modules'],
    prompts: v1.prompts as AgentManifestV2['prompts'],
    tools: (v1.tools ?? []) as AgentManifestV2['tools'],
    ai: v1.ai as AgentManifestV2['ai'],
    reviews: v1.reviews as AgentManifestV2['reviews'],
    matters: v1.matters as AgentManifestV2['matters'],
    source: v1.source as AgentManifestV2['source'],
  };
}
