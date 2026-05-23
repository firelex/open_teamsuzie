// Browser-safe schema types (type-only).
export type {
  AgentManifest, ManifestTheme, ManifestPersona, ManifestComponents,
  ManifestModules, ManifestPrompt, ManifestTool, ThemeId, ThemeTokens, ToolStatus,
} from './manifest/schema.js';

// Browser-safe manifest helpers (no node:fs).
export {
  DEFAULT_COMPONENTS, DEFAULT_MODULES, resolveModules, listPersonas, findPersona,
  defaultManifest,
} from './manifest/defaults.js';

// React shell + pages.
export { AgentApp } from './shell/AgentApp.js';
export { Sidebar, type NavItem } from './shell/Sidebar.js';
export { Wordmark } from './shell/Wordmark.js';
export * from './pages/index.js';

// Node-only re-exports (server, presets, ManifestStore, loadManifest) live
// under subpaths: '@teamsuzie/agent-runtime/server',
// '@teamsuzie/agent-runtime/presets', '@teamsuzie/agent-runtime/manifest'.
