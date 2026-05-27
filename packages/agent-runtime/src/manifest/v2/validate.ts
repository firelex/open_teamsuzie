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

const passthroughObject = z.object({}).passthrough();

/**
 * v2 manifest validator. Brand is validated strictly; carry-forward
 * fields use passthrough so we don't have to duplicate v1 shapes here.
 * The v1 validator already governs them on the read path before
 * migration; on the write path, tools that mutate carry-forward
 * fields run their own v1-style validation.
 */
export const manifestV2Schema = z.object({
  version: z.literal(2),
  brand,
  description: z.string(),
  theme: passthroughObject,
  persona: passthroughObject,
  extraPersonas: z.array(passthroughObject).optional(),
  components: passthroughObject,
  modules: passthroughObject.optional(),
  prompts: z.array(passthroughObject).optional(),
  tools: z.array(passthroughObject),
  ai: passthroughObject.optional(),
  reviews: passthroughObject.optional(),
  matters: passthroughObject.optional(),
  source: z.object({
    builder: z.string().optional(),
    builderVersion: z.string().optional(),
    builderRunId: z.string().optional(),
  }).optional(),
});

export function validateManifestV2(raw: unknown): AgentManifestV2 {
  return manifestV2Schema.parse(raw) as unknown as AgentManifestV2;
}
