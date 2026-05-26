import { z } from 'zod';
import type { AgentManifest } from './schema.js';

const themeTokens = z.object({
  colorScheme: z.enum(['light', 'dark']).optional(),
  bg: z.string().optional(),
  panel: z.string().optional(),
  border: z.string().optional(),
  fg: z.string().optional(),
  muted: z.string().optional(),
  primary: z.string().optional(),
  fontSans: z.string().optional(),
  fontMono: z.string().optional(),
  fontLinks: z.string().optional(),
  fontDisplay: z.string().optional(),
  wordmarkStyle: z.enum(['single', 'two-line']).optional(),
  sidebarBg: z.string().optional(),
  sidebarFg: z.string().optional(),
  sidebarFgMuted: z.string().optional(),
  accentBar: z.object({ color: z.string().optional(), width: z.string().optional() }).optional(),
}).passthrough();

const theme = z.object({
  id: z.string(),
  tokens: themeTokens.optional(),
  fontLinks: z.string().optional(),
});

const persona = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string(),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  blockedTools: z.array(z.string()).optional(),
});

const components = z.object({
  chat: z.boolean(),
  toolActivity: z.boolean(),
  approvals: z.boolean(),
  knowledgeBase: z.boolean(),
  files: z.boolean(),
  citations: z.boolean(),
  workspace: z.boolean(),
});

const modules = z.object({
  assistant: z.boolean(),
  history: z.boolean(),
  personas: z.boolean(),
  settings: z.boolean(),
  matters: z.boolean(),
  library: z.boolean(),
  knowledgeBase: z.boolean(),
  admin: z.boolean(),
  reviews: z.boolean(),
  billing: z.boolean(),
  redline: z.boolean(),
  drafting: z.boolean(),
}).partial();

const tool = z.object({
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(['stub', 'implemented']),
  enabled: z.boolean(),
  parameters: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
});

const prompt = z.object({
  title: z.string(),
  subtitle: z.string(),
  prompt: z.string().optional(),
  practiceAreas: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
});

export const agentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string(),
  theme,
  persona,
  personas: z.array(persona).optional(),
  components,
  modules: modules.optional(),
  prompts: z.array(prompt).optional(),
  tools: z.array(tool),
  ai: z.object({
    simpleModel: z.object({
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string(),
    }).optional(),
  }).optional(),
  reviews: z.object({ templates: z.array(z.unknown()).optional() }).optional(),
  matters: z.object({
    label: z.object({ singular: z.string().optional(), plural: z.string().optional() }).optional(),
    types: z.array(z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      customFields: z.array(z.unknown()).optional(),
    })).optional(),
  }).optional(),
  source: z.object({
    builder: z.string().optional(),
    builderVersion: z.string().optional(),
    builderRunId: z.string().optional(),
  }).optional(),
});

export type ValidateResult =
  | { ok: true; value: AgentManifest }
  | { ok: false; errors: string[] };

export function validateManifest(raw: unknown): ValidateResult {
  const parsed = agentManifestSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data as AgentManifest };
  }
  const errors = parsed.error.issues.map((iss) => {
    const path = iss.path.length ? iss.path.join('.') : '(root)';
    return `${path}: ${iss.message}`;
  });
  return { ok: false, errors };
}
