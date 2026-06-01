import { z } from 'zod';
import type { AgentManifestV2 } from './schema.js';

const brandLogo = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), wordmark: z.string().min(1) }),
  z.object({ type: z.literal('asset'), assetId: z.string().min(1) }),
]);

const brand = z.object({
  name: z.string().min(1),
  shortName: z.string().optional(),
  tagline: z.string().optional(),
  logo: brandLogo.optional(),
  favicon: z.object({ assetId: z.string().min(1) }).optional(),
});

const home = z.object({
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  welcomeMessage: z.string().optional(),
  starterPrompts: z.array(z.string()),
  disclaimerPlacement: z.enum(['prominent', 'footer', 'hidden']),
});

const legal = z.object({
  jurisdictions: z.array(z.string()),
  disclaimer: z.string(),
  clientFacing: z.boolean(),
  requireHumanReviewFor: z.array(z.string()),
  forbid: z.array(z.string()),
});

const capabilities = z.object({
  chat: z.boolean(),
  fileUploads: z.boolean(),
  docxDrafting: z.boolean(),
  redlines: z.boolean(),
  legalResearch: z.boolean(),
  citations: z.boolean(),
  matters: z.boolean(),
  reviewGrids: z.boolean(),
  clientSharing: z.boolean(),
  approvals: z.boolean(),
  workspace: z.boolean(),
});

const navItem = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  visible: z.boolean(),
  order: z.number().int().optional(),
});

const navigation = z.object({
  items: z.array(navItem),
});

const audience = z.object({
  mode: z.enum(['solo_builder', 'firm_internal', 'client_portal', 'public']),
  requiresLogin: z.boolean(),
  clientSafeMode: z.boolean(),
  allowAnonymousPreview: z.boolean(),
});

const passthroughObject = z.object({}).passthrough();

/**
 * Prompt seeds carried in `manifest.prompts[]`. The runtime seeds them into
 * the workflows store via `p.title` / `p.subtitle` / `p.prompt`. A previous
 * passthrough schema let architects emit alternate shapes (e.g.
 * `{ body, outputMode: 'chat' }`) that silently produced empty Library
 * cards. Strict so validate_manifest rejects the wrong shape and the
 * architect's replan loop gets a chance to correct it.
 */
const promptSeed = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  prompt: z.string().min(1),
  practiceAreas: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
  outputMode: z.enum(['inline_chat', 'generate_docx', 'review']).optional(),
});

/**
 * Persona shape — used for `persona` and each entry in `extraPersonas[]`.
 * Only `id` is required (the runtime keys personas by id and falls back to
 * id for display when `name` is missing); other fields are optional so a
 * minimal `{ id, systemPrompt }` shape — common in test fixtures and
 * lightweight starters — passes validation. The runtime filters out
 * personas without a `systemPrompt` at register time, so we don't need to
 * enforce non-empty content here.
 */
const personaSeed = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  avatar: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  blockedTools: z.array(z.string()).optional(),
});

/**
 * Tool declaration. The architect's tools are intent stubs at this stage
 * (status:'stub'); coding-agent runs flip them to 'implemented'. Keep the
 * shape strict so missing `description` or wrong `status` values get
 * surfaced at submit time rather than at boot.
 */
const toolSeed = z.object({
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(['stub', 'implemented']),
  enabled: z.boolean(),
  parameters: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
});

/**
 * v2 manifest validator. Brand is validated strictly; the blocks that
 * carry through from v1 (theme/components/modules/ai/reviews/matters)
 * use passthrough so we don't have to duplicate v1 shapes here — the v1
 * validator governs them on the read path before migration. Blocks the
 * architect commonly gets wrong (prompts/tools/personas) are now strict
 * so validate_manifest catches shape mismatches before they ship.
 */
export const manifestV2Schema = z.object({
  version: z.literal(2),
  brand,
  home,
  legal,
  capabilities,
  navigation,
  audience,
  description: z.string(),
  theme: passthroughObject,
  persona: personaSeed,
  extraPersonas: z.array(personaSeed).optional(),
  components: passthroughObject,
  modules: passthroughObject.optional(),
  prompts: z.array(promptSeed).optional(),
  tools: z.array(toolSeed),
  ai: passthroughObject.optional(),
  reviews: passthroughObject.optional(),
  matters: passthroughObject.optional(),
  source: z.object({
    builder: z.string().optional(),
    builderVersion: z.string().optional(),
    builderRunId: z.string().optional(),
  }).optional(),
}).superRefine((v, ctx) => {
  // Hard invariant #1: mode=client_portal/public ⇒ legal.clientFacing=true
  if (
    (v.audience.mode === 'client_portal' || v.audience.mode === 'public')
    && v.legal.clientFacing !== true
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audience', 'mode'],
      message: `audience.mode=${v.audience.mode} requires legal.clientFacing=true`,
    });
  }
  // Hard invariant #2: requiresLogin=false only when mode=solo_builder
  if (v.audience.requiresLogin === false && v.audience.mode !== 'solo_builder') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audience', 'requiresLogin'],
      message: `requiresLogin=false only permitted when audience.mode=solo_builder (got mode=${v.audience.mode})`,
    });
  }
});

export function validateManifestV2(raw: unknown): AgentManifestV2 {
  return manifestV2Schema.parse(raw) as unknown as AgentManifestV2;
}
