import type { ReviewTemplateSeed } from '@teamsuzie/reviews';

/**
 * Agent manifest contract.
 *
 * The manifest is the single source of truth for what an SDK-based agent IS:
 * its title/description, theme, persona, which UI modules are on, and its
 * tool registry (including stub tools that have not been implemented yet).
 * The runtime reads it on boot and re-reads it on demand so that mutations
 * from outside (e.g. SuzieCode's builder UI) take effect without code edits.
 */
export type ThemeId = string;

export interface ThemeTokens {
  colorScheme?: 'light' | 'dark';
  bg?: string;
  panel?: string;
  border?: string;
  fg?: string;
  muted?: string;
  primary?: string;
  fontSans?: string;
  fontMono?: string;
  fontLinks?: string;
  // Shell-shape tokens (Phase 2 will read these).
  fontDisplay?: string;
  wordmarkStyle?: 'single' | 'two-line';
  sidebarBg?: string;
  sidebarFg?: string;
  /** Color for INACTIVE sidebar nav rows. Falls back to sidebarFg if unset.
   *  Defaults to `#9a9a94` (see DEFAULT_THEME_TOKENS) so inactive rows stay
   *  legible against a dark sidebarBg. */
  sidebarFgMuted?: string;
  accentBar?: { color?: string; width?: string };
}

export interface ManifestTheme {
  id: ThemeId;
  tokens?: ThemeTokens;
}

export interface ManifestPersona {
  id: string;
  name?: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  allowedTools?: string[];
  blockedTools?: string[];
}

export interface ManifestComponents {
  chat: boolean;
  toolActivity: boolean;
  approvals: boolean;
  knowledgeBase: boolean;
  files: boolean;
  citations: boolean;
  workspace: boolean;
}

export interface ManifestModules {
  assistant: boolean;
  history: boolean;
  personas: boolean;
  settings: boolean;
  matters: boolean;
  library: boolean;
  knowledgeBase: boolean;
  admin: boolean;
  reviews: boolean;
  billing: boolean;
}

export type ToolStatus = 'stub' | 'implemented';

export interface ManifestTool {
  name: string;
  description: string;
  status: ToolStatus;
  enabled: boolean;
  parameters?: Record<string, unknown>;
  notes?: string;
}

export interface ManifestPrompt {
  title: string;
  subtitle: string;
  prompt?: string;
  /** Practice areas this prompt belongs to (e.g. ["antitrust", "litigation"]).
   *  LibraryPage builds a filter chip row from the union across all prompts. */
  practiceAreas?: string[];
  /** When true, show as a starter tile on the Assistant landing page (up to 4).
   *  When false/undefined, the prompt lives in the Library only. */
  featured?: boolean;
}

/**
 * Optional AI configuration. `simpleModel` is the small/cheap model used by
 * server-side AI-fill (POST /api/ai/draft) and any other utility chat call
 * that doesn't need the full agent loop. When undefined the AI-fill endpoint
 * returns 503 and clients are expected to hide the affected affordances.
 */
export interface ManifestAi {
  simpleModel?: {
    baseUrl: string;
    apiKey?: string;
    model: string;
  };
}

/**
 * Manifest-side configuration for the Reviews module. Templates listed here
 * are seeded into the reviews store as user-owned defaults on first boot
 * (via `seedAsUserIfEmpty`); subsequent edits and deletes are preserved.
 */
export interface ManifestReviews {
  templates?: ReviewTemplateSeed[];
}

export interface AgentManifest {
  schemaVersion: 1;
  name: string;
  description: string;
  theme: ManifestTheme;
  persona: ManifestPersona;
  personas?: ManifestPersona[];
  components: ManifestComponents;
  modules?: Partial<ManifestModules>;
  prompts?: ManifestPrompt[];
  tools: ManifestTool[];
  ai?: ManifestAi;
  reviews?: ManifestReviews;
  source?: {
    builder?: string;
    builderVersion?: string;
    builderRunId?: string;
  };
}
