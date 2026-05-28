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

  // Legacy short-name palette aliases — preserved so existing manifests
  // (and tools that hand-write `theme.tokens`) keep validating. New code
  // should write the explicit role-named fields below; the runtime hook
  // reads BOTH and the explicit fields win when present.
  bg?: string;
  panel?: string;
  border?: string;
  fg?: string;
  muted?: string;
  primary?: string;
  /** Secondary accent. Designs with a brand gradient (TeamSuzie's pink)
   *  carry the second stop here. Maps to `--color-accent` (and ring). */
  accent?: string;

  // Explicit role palette — every Tailwind --color-* var gets a token
  // so a theme swap replaces ALL surfaces atomically, not just the core
  // six. When unset, the runtime hook leaves the var alone and the
  // build's seed-time @theme default applies.
  background?: string;
  foreground?: string;
  card?: string;
  cardForeground?: string;
  popover?: string;
  popoverForeground?: string;
  primaryForeground?: string;
  secondary?: string;
  secondaryForeground?: string;
  /** Surface tint for muted backgrounds (chips, secondary panels). Distinct
   *  from `mutedForeground` which is the TEXT color for helper copy.
   *  Previous schema collapsed these into `muted` which the hook then
   *  wrote to both --color-muted and --color-muted-foreground — visibly
   *  wrong on light themes where surface ≈ near-white but text needs
   *  to be a mid-gray. */
  mutedForeground?: string;
  accentForeground?: string;
  destructive?: string;
  destructiveForeground?: string;
  input?: string;
  ring?: string;
  success?: string;

  fontSans?: string;
  fontMono?: string;
  fontLinks?: string;
  fontDisplay?: string;
  wordmarkStyle?: 'single' | 'two-line';

  // Sidebar surface — keeps its existing flat-field layout for back-compat;
  // new fields (`sidebarHoverBg`, `sidebarActiveBg`) are additive.
  sidebarBg?: string;
  sidebarFg?: string;
  /** Color for INACTIVE sidebar nav rows. Falls back to sidebarFg if unset.
   *  Defaults to `#9a9a94` (see DEFAULT_THEME_TOKENS) so inactive rows stay
   *  legible against a dark sidebarBg. */
  sidebarFgMuted?: string;
  /** Background painted under a sidebar nav row on hover. Falls back to
   *  transparent (no hover affordance) when unset. */
  sidebarHoverBg?: string;
  /** Background painted under the currently-active sidebar nav row. Some
   *  designs (Counsel) leave this transparent and rely on the accent bar
   *  alone; others (TeamSuzie) paint a saturated brand tint here. */
  sidebarActiveBg?: string;
  accentBar?: { color?: string; width?: string };
}

export interface ManifestTheme {
  id: ThemeId;
  tokens?: ThemeTokens;
  /**
   * Optional `<link>` HTML to load this theme's web fonts at runtime.
   * The runtime shell parses out `href` attributes and ensures matching
   * `<link rel="preconnect"|"stylesheet">` elements exist in `document.head`.
   *
   * Format: a single string with one or more `<link>` tags, same shape
   * the seed-time `{{FONT_LINKS}}` substitution produces. When present,
   * a theme switch persists the new font URLs via this field so the
   * browser actually downloads the family the tokens reference (the
   * tokens decide *what's used*; this decides *what's loaded*).
   *
   * When absent, the browser uses whatever fonts the host `index.html`
   * preloaded — typically only the seed-time theme's family — and a
   * theme switch to a different family falls back to system sans/mono.
   */
  fontLinks?: string;
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

/**
 * v1 chat-surface component flags. **Deprecated as a write surface for
 * new manifests** — capabilities is canonical (see v2/schema.ts
 * CapabilitiesBlock). Still accepted on read so legacy v1 manifests
 * continue to load; the runtime currently does not gate any behavior
 * on these flags.
 */
export interface ManifestComponents {
  chat: boolean;
  toolActivity: boolean;
  approvals: boolean;
  knowledgeBase: boolean;
  files: boolean;
  citations: boolean;
  workspace: boolean;
}

/**
 * v1 module-gating flags. **Deprecated as a write surface for new
 * manifests** — capabilities is canonical (see v2/schema.ts
 * CapabilitiesBlock). Still accepted on read as an explicit override
 * layer over capability-derived values; see
 * `defaults.ts:resolveModules` for the layering rule.
 */
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
  redline: boolean;
  drafting: boolean;
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
  /** Stable identifier. When set, home.starterPrompts entries match against
   *  this id first (then title). Lets `set_home` reference prompts
   *  without depending on the title staying unique or unchanged. */
  id?: string;
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
  /**
   * Small/cheap model for AI-fill (POST /api/ai/draft) and other utility calls.
   * Only `model` is required — `baseUrl` and `apiKey` fall back to `opts.agent`
   * when omitted, so builds that share one LLM target don't need to repeat the
   * baseUrl/apiKey in agent.json (and avoid putting credentials in the file).
   */
  simpleModel?: {
    baseUrl?: string;
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

/**
 * One custom field on a matter type. Field values land in
 * matter_metadata.custom_fields_json keyed by `key`. The host UI
 * renders one input per field type:
 *   - text    → text input
 *   - number  → number input (numeric-string accepted; coerced server-side)
 *   - date    → date input (YYYY-MM-DD string)
 *   - enum    → select with `options`
 *   - boolean → switch (true / false)
 */
export type ManifestCustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'enum'
  | 'boolean';

export interface ManifestCustomField {
  /** Stable key used in matter_metadata.custom_fields_json. */
  key: string;
  label: string;
  type: ManifestCustomFieldType;
  /** When true, the create / edit form blocks submit if the value is empty. */
  required?: boolean;
  /** Required for `type: 'enum'`. Ignored otherwise. */
  options?: string[];
  /** Optional helper copy under the input. */
  description?: string;
}

/**
 * One matter "type" — a vertical subtype like deal/case/engagement.
 * Optional: a build with no `types` (or an empty array) operates in
 * implicit-single-type mode (one untyped flat shape, no fields). Build
 * with `types.length === 1` uses that single type without a picker;
 * build with `types.length > 1` shows a picker at create time and
 * groups the matter list by type in the sidebar.
 */
export interface ManifestMatterType {
  /** Stable id used in matter_metadata.type_id. */
  id: string;
  label: string;
  description?: string;
  customFields?: ManifestCustomField[];
}

/**
 * Manifest-side configuration for the Matters module. The label lets each
 * vertical re-skin the noun ("Matter" → "Deal" / "Case" / "Engagement")
 * without forking the UI. Both halves are optional; missing pieces fall
 * back to the default ("Matter" / "Matters") rather than being naively
 * pluralised so copy stays predictable.
 *
 * `types[]` adds optional subtypes with custom fields — see
 * `ManifestMatterType` for the shape.
 */
export interface ManifestMatters {
  label?: {
    singular?: string;
    plural?: string;
  };
  types?: ManifestMatterType[];
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
  matters?: ManifestMatters;
  source?: {
    builder?: string;
    builderVersion?: string;
    builderRunId?: string;
  };
}
