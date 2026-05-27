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
