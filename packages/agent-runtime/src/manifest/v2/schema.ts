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

export interface BrandBlock {
  name: string;
  shortName?: string;
  tagline?: string;
  logo?: BrandLogo;
  favicon?: { assetId: string };
}

/**
 * Manifest v2. Plan 01 adds `brand` and the `version` discriminator.
 * Every other field carries forward from v1 unchanged; subsequent
 * plans (home, legal, capabilities, navigation, audience) will peel
 * more fields off the carry-forward into v2 shape.
 */
export interface AgentManifestV2 {
  version: 2;
  brand: BrandBlock;

  // Carry-forward from v1 — to be migrated by later plans.
  persona: ManifestPersona;
  extraPersonas?: ManifestPersona[];
  ai: ManifestAi;
  tools: ManifestTool[];
  theme: ManifestTheme;
  modules: ManifestModules;
  components: ManifestComponents;
  matters?: ManifestMatters;
  reviews?: ManifestReviews;
}
