import type {
  AgentManifest,
  ManifestComponents,
  ManifestModules,
  ManifestPersona,
  ThemeTokens,
} from './schema.js';

/**
 * Default values for optional theme tokens. These are *defaults only* — any
 * value the manifest's `theme.tokens` provides wins. Consumers (e.g. Sidebar)
 * read `tokens.<x> ?? DEFAULT_THEME_TOKENS.<x>` so an agent.json with no theme
 * still produces a legible UI.
 */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  sidebarFgMuted: '#9a9a94',
};

export const DEFAULT_COMPONENTS: ManifestComponents = {
  chat: true,
  toolActivity: true,
  approvals: false,
  knowledgeBase: false,
  files: false,
  citations: false,
  workspace: false,
};

export const DEFAULT_MODULES: ManifestModules = {
  assistant: true,
  history: true,
  personas: true,
  settings: true,
  matters: false,
  library: false,
  knowledgeBase: false,
  admin: false,
  reviews: false,
  billing: false,
};

export function resolveModules(manifest: AgentManifest): ManifestModules {
  return { ...DEFAULT_MODULES, ...(manifest.modules ?? {}) };
}

export function defaultManifest(): AgentManifest {
  return {
    schemaVersion: 1,
    name: 'Agent',
    description: 'An SDK-based agent.',
    theme: { id: 'default' },
    persona: {
      id: 'default',
      name: 'Default',
      systemPrompt:
        'You are a helpful assistant. Answer clearly and use tools when they help.',
    },
    components: { ...DEFAULT_COMPONENTS },
    tools: [],
  };
}

export function listPersonas(manifest: AgentManifest): ManifestPersona[] {
  const out: ManifestPersona[] = [manifest.persona];
  if (Array.isArray(manifest.personas)) {
    for (const p of manifest.personas) {
      if (p && p.id !== manifest.persona.id) out.push(p);
    }
  }
  return out;
}

export function findPersona(
  manifest: AgentManifest,
  id: string | null | undefined,
): ManifestPersona {
  if (!id) return manifest.persona;
  return listPersonas(manifest).find((p) => p.id === id) ?? manifest.persona;
}
