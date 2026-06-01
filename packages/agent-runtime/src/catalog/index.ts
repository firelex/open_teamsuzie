/**
 * Feature catalog — typed descriptions of every module and component an agent
 * can enable.
 *
 * Why this exists:
 *   1. Discoverability. When SuzieCode (or any agent built on this runtime)
 *      explains a feature to the user — "what does Library do?" — it should
 *      give a real answer, not a hallucination derived from the one-line
 *      label in agent-config-docs.md. The catalog is the source of truth.
 *   2. Brainstorming. The SuzieCode build flow needs to suggest what to
 *      include in a new agent ("you said legal diligence — turn on matters,
 *      redline, and citations"). That requires knowing what each feature DOES
 *      and what it pairs with, not just that it exists.
 *
 * The contract:
 *   - Every key in MODULE_KEYS and COMPONENT_KEYS MUST have a descriptor in
 *     the corresponding catalog. Enforced at type-level via
 *     `Record<ModuleKey, FeatureDescriptor>` (TS will fail if you add a key
 *     without an entry) AND at runtime via the catalog coverage test.
 *   - Adding a new key to MODULE_KEYS / COMPONENT_KEYS requires a matching
 *     descriptor. Don't ship features without a description.
 *
 * Mirrors agent-config-docs.md (## Modules, ## Components) but is structured
 * for programmatic consumption: an LLM tool can return `{ purpose,
 * upstreamPackages, addsRoutes, dependsOn, worksWellWith, examples }` as one
 * coherent record, instead of grepping a markdown body.
 */

import type { ManifestComponents, ManifestModules } from '../manifest/schema.js';

/** One key in the components boolean dictionary (chat, toolActivity, …). */
export type ComponentKey = keyof ManifestComponents;
/** One key in the modules boolean dictionary (assistant, matters, …). */
export type ModuleKey = keyof ManifestModules;

export interface FeatureDescriptor {
  /** The boolean key in agent.json (`/modules/<key>` or `/components/<key>`). */
  key: string;
  /** Human display name as it would appear in the UI (sidebar label, settings
   *  toggle label). Title-case. */
  label: string;
  /** 2-4 sentence "what it does + when to use it". The voice the agent should
   *  reach for when asked to describe this feature. */
  purpose: string;
  /** Upstream packages (under `@teamsuzie/`) this feature is backed by. Empty
   *  array when the feature is implemented inside agent-runtime itself
   *  (assistant, settings, files, etc.). */
  upstreamPackages: string[];
  /** URL paths this feature adds to the agent's React routes. Only meaningful
   *  for modules (sidebar nav items); components don't add routes. Empty
   *  when the feature has no dedicated route surface. */
  addsRoutes: string[];
  /** Other modules / components that this feature requires to function. E.g.
   *  `redline` depends on `files`. Listed as bare keys so the consumer can
   *  cross-reference with MODULE_CATALOG / COMPONENT_CATALOG. */
  dependsOn: string[];
  /** Synergy hints — features that meaningfully amplify this one when also
   *  enabled. Used in brainstorm flows ("if you're turning on KB, you
   *  probably also want citations"). */
  worksWellWith: string[];
  /** 1-3 phrasings a user might use to ask for this feature. Helps the
   *  brainstorm agent match natural-language requests to feature keys
   *  ("clients want me to redline contracts" → `redline`). */
  examples: string[];
}

export { MODULE_KEYS, MODULE_CATALOG } from './modules.js';
export { COMPONENT_KEYS, COMPONENT_CATALOG } from './components.js';
