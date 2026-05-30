// packages/agent-runtime/src/manifest/v2/schema.ts
import type {
  ManifestPersona,
  ManifestAi,
  ManifestTool,
  ManifestTheme,
  ManifestComponents,
  ManifestModules,
  ManifestMatters,
  ManifestReviews,
  ManifestPrompt,
} from '../schema.js';

/**
 * v2 brand block — replaces the v1 top-level `name`.
 *
 * `logo` and `favicon` reference assets stored in the build's
 * `assets/` directory and served at `/assets/<assetId>` by the runtime.
 */
export type BrandLogo =
  | { type: 'text'; wordmark: string }
  | { type: 'asset'; assetId: string };

/**
 * Public-facing brand identity. `name` replaces v1's top-level `name`.
 * `shortName` is used for the sidebar wordmark; `tagline` for the
 * marketing one-liner; `logo` and `favicon` reference assets in
 * `<build>/assets/<assetId>`.
 */
export interface BrandBlock {
  name: string;
  shortName?: string;
  tagline?: string;
  logo?: BrandLogo;
  favicon?: { assetId: string };
}

/**
 * Home block — first-screen overrides for the lawyer's deployed app.
 *
 * `headline` / `subheadline` / `welcomeMessage` are direct text overrides
 * rendered in the empty-chat Greeting. `starterPrompts` is an ordered
 * list of prompt titles (the existing natural key on `ManifestPrompt`)
 * pulled from `manifest.prompts` for the suggested-tile row.
 *
 * `disclaimerPlacement` is wired here so set_home can persist it, but the
 * runtime doesn't read it until Plan 03 (Legal) ships `legal.disclaimer`.
 */
export interface HomeBlock {
  headline?: string;
  subheadline?: string;
  welcomeMessage?: string;
  starterPrompts: string[];
  disclaimerPlacement: 'prominent' | 'footer' | 'hidden';
}

/**
 * Legal block — jurisdiction-scoped guardrails for the lawyer's app.
 *
 * `disclaimer` is the prose rendered as a banner per `home.disclaimerPlacement`.
 * `jurisdictions` are shown in the sidebar footer ("England and Wales" etc.).
 * `requireHumanReviewFor` and `forbid` are topic strings (NOT tool names) —
 * the runtime appends them to the persona's system prompt on every turn so
 * the agent knows what to refuse / escalate. (Future plan may map them to a
 * structured tool-guard pipeline.)
 *
 * `clientFacing` declares the deployed app is client-facing — set_legal also
 * upgrades `home.disclaimerPlacement` to 'prominent' as an auto-default when
 * this transitions to true.
 */
export interface LegalBlock {
  jurisdictions: string[];
  disclaimer: string;
  clientFacing: boolean;
  requireHumanReviewFor: string[];
  forbid: string[];
}

/**
 * Capabilities block — lawyer-friendly product flags.
 *
 * Runtime-active flags (drive route/tool gating via capabilitiesToModules):
 *   - matters       → mounts /api/matters + Matters nav
 *   - legalResearch → mounts /api/kb + Knowledge Base hooks
 *   - reviewGrids   → enables Reviews module
 *   - docxDrafting  → enables drafting tool registration
 *   - redlines      → enables redline/blackline tool registration
 *
 * Currently-noop flags (declarative product intent; runtime doesn't gate
 * on them yet — pending UI wiring):
 *   - chat              (chat is always-on)
 *   - fileUploads
 *   - citations
 *   - clientSharing
 *   - approvals
 *   - workspace
 *
 * Setting a noop flag has no runtime effect today. Use modules.* directly
 * if you need to gate a specific surface before this is wired.
 *
 * The legacy `modules`/`components` fields remain accepted on input (for v1
 * back-compat and explicit per-module overrides) but new SuzieCode-
 * generated manifests only populate `capabilities`.
 */
export interface CapabilitiesBlock {
  chat: boolean;
  fileUploads: boolean;
  docxDrafting: boolean;
  redlines: boolean;
  legalResearch: boolean;
  citations: boolean;
  matters: boolean;
  reviewGrids: boolean;
  clientSharing: boolean;
  approvals: boolean;
  workspace: boolean;
}

/**
 * Single sidebar nav item. `id` references a built-in route key (e.g.
 * 'assistant', 'matters', 'library', 'personas', 'reviews', 'history').
 * `label` is the visible text. `visible` controls whether the item renders
 * at all (false hides it but persists in the array — set_navigation can
 * restore it). `order` is an optional integer; ties broken by array order.
 */
export interface NavItem {
  id: string;
  label: string;
  visible: boolean;
  order?: number;
}

export interface NavigationBlock {
  items: NavItem[];
}

/**
 * Audience block — who is the deployed app for, and how is access gated.
 *
 * Hard invariants (enforced in validator):
 *   - mode ∈ {'client_portal', 'public'} ⇒ legal.clientFacing === true
 *   - requiresLogin === false only when mode === 'solo_builder'
 *
 * Auto-defaults (applied by set_audience write):
 *   - mode transitions to client_portal/public ⇒ clientSafeMode auto-true
 *     (unless the same write sets clientSafeMode: false explicitly).
 *   - mode transitions to client_portal/public ⇒ legal.clientFacing auto-true
 *     (and home.disclaimerPlacement is promoted to 'prominent' if it wasn't).
 */
export type AudienceMode = 'solo_builder' | 'firm_internal' | 'client_portal' | 'public';

export interface AudienceBlock {
  mode: AudienceMode;
  requiresLogin: boolean;
  clientSafeMode: boolean;
  allowAnonymousPreview: boolean;
}

/**
 * Manifest v2. Plan 01 introduces:
 *   - `version: 2` (renamed from v1's `schemaVersion: 1`)
 *   - `brand` (replaces v1's top-level `name`)
 *   - `extraPersonas` (renamed from v1's `personas`)
 *
 * Every other v1 field carries forward verbatim — same names, same
 * optionality, same shape — until subsequent plans peel them into v2
 * shape (home, legal, capabilities, navigation, audience).
 */
export interface AgentManifestV2 {
  version: 2;
  brand: BrandBlock;
  home: HomeBlock;
  legal: LegalBlock;
  capabilities: CapabilitiesBlock;
  navigation: NavigationBlock;
  audience: AudienceBlock;
  description: string;
  theme: ManifestTheme;
  persona: ManifestPersona;
  extraPersonas?: ManifestPersona[];
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
