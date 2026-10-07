# @teamsuzie/agent-runtime

Manifest-driven agent shell: an Express server boot plus a React app that every Team Suzie starter and SuzieCode-generated build boots from. A build supplies an `agent.json` manifest (persona, enabled modules/components, branding, legal guardrails, …) and this package turns it into a running app.

Because it bundles a server, a React shell, and Node-only tooling, its exports are split across subpaths so browser bundles never pull in `node:fs`/Express:

```ts
import { AgentApp } from '@teamsuzie/agent-runtime';            // React shell (browser-safe)
import { startAgent } from '@teamsuzie/agent-runtime/server';   // Express boot (Node-only)
import { applyPreset } from '@teamsuzie/agent-runtime/presets'; // preset materialization (Node-only)
import { loadExtensions } from '@teamsuzie/agent-runtime/extensions';
import { MODULE_CATALOG } from '@teamsuzie/agent-runtime/catalog';
import { defaultManifest } from '@teamsuzie/agent-runtime/manifest/defaults';
```

## Quickstart (server)

```ts
import 'dotenv/config';
import { startAgent } from '@teamsuzie/agent-runtime/server';

startAgent({
  manifestPath: './agent.json',
  dbPath: process.env.DB_PATH ?? './data/myagent.db',
  personasDir: './personas',
  workflowsSeedPath: './workflows.seed.json',
  devAuth: process.env.AGENT_DEV_AUTH === 'true',
  agent: {
    baseUrl: process.env.AGENT_BASE_URL!,
    apiKey: process.env.AGENT_API_KEY,
    model: process.env.AGENT_MODEL!,
  },
}).catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
```

## Quickstart (client)

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AgentApp } from '@teamsuzie/agent-runtime';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AgentApp />
    </BrowserRouter>
  </StrictMode>,
);
```

## Main parts

- **`manifest/`** — the `AgentManifest` schema (`agent.json`'s shape), `defaultManifest()`, `resolveModules(manifest)` (merges `manifest.modules` with `DEFAULT_MODULES`), `listPersonas`/`findPersona`, a JSON-Patch-based `history.ts`, and `ManifestStore` (file-backed, watches for edits). A v2 manifest format with its own loader/migrator lives under `manifest/v2/`.
- **`server/`** (subpath `/server`, Node-only) — `createApp(opts): Promise<{ app, close }>` builds the Express app; `startAgent(opts)` builds it and starts listening. Composes `@teamsuzie/chats`, `@teamsuzie/personas`, `@teamsuzie/reviews`, `@teamsuzie/grid-review`, `@teamsuzie/workflows`, `@teamsuzie/workspaces`, `@teamsuzie/sharing`, `@teamsuzie/matters`, `@teamsuzie/docx`, `@teamsuzie/agent-loop`, and `@teamsuzie/platform-bridge` into the runtime's HTTP surface (`/api/chat`, `/api/manifest`, `/api/matters`, `/api/files`, `/api/ai/draft`, `/api/health`, plus module-gated routers). Every router beyond manifest/health is mounted only when the matching `manifest.modules.*` flag is on.
- **`shell/`** (browser) — `AgentApp`, the top-level React component (layout, sidebar, routing), plus `Sidebar`, `Wordmark`, and theme-token hooks.
- **`pages/`** (browser) — the page components `AgentApp` routes to (Assistant, History, Library, Matters, Personas, Reviews, Settings, …).
- **`extensions/`** (subpath `/extensions`) — the `Extension` SDK (`loadExtensions(dir)`) that lets a build contribute modules/tools/AI-draft kinds from `extensions/<name>/index.ts` without forking core. See `EXTENSIONS.md` in this package for the full authoring guide.
- **`presets/`** (subpath `/presets`) — `applyPreset(buildDir, presetDir, overrides?)` materializes a starter preset's `agent.json` (plus `personas/` and `workflows.seed.json`) onto a build directory, merging `preset ← overrides ← existing build` so re-running is idempotent and existing build edits always win. `listBuiltinPresets(presetsRoot)` / `resolvePresetDir(presetsRoot, name)` are the companion discovery helpers.
- **`catalog/`** (subpath `/catalog`) — `MODULE_CATALOG` / `COMPONENT_CATALOG`, typed descriptors (`purpose`, `upstreamPackages`, `addsRoutes`, `dependsOn`, `worksWellWith`, `examples`) for every module/component key, used so an agent can explain its own features instead of guessing.

## Configuration (server)

Passed via `StartAgentOptions` (all but `manifestPath` optional): `dbPath`, `filesDataDir` (`null` to disable on-disk file persistence), `personasDir`, `workflowsSeedPath`, `templatesDir`, `port`, `devAuth`, `agent` (`{ baseUrl, apiKey?, model, systemPrompt?, extraBody? }`), `agentRegistry`, `extensionsDir`, `extensions` (programmatic `Extension[]`), `publicDir`, `markitdown` (`{ baseUrl, fetchImpl? }`).

Environment variables read directly by `server/index.ts`: `AGENT_DEV_AUTH`, `AGENT_ALLOWED_ORIGINS` (comma-separated CORS allowlist), `ALLOWED_ORIGIN` (single-origin fallback), `AGENT_LOCAL_TOKEN` (requires `X-SuzieCode-Token` on every `/api` request), `PLATFORM_TOKEN`, `MARKITDOWN_AGENT_BASE_URL`, `PORT`.

## Notable behaviour

- Without `opts.agent`, `/api/chat` returns `503`; the chat UI should treat that as "no model configured" rather than a generic error.
- `/api/health` and `/api/webhook/*` are exempt from session, local-token, and origin checks so SuzieCode can poll readiness and receive webhooks before auth is established.
- Extensions load after core registrations and win on name collisions ("last write wins"); extension module names must not collide with the core module names (`library`, `personas`, `history`, `settings`, `assistant`, `reviews`).
- `bin/agent-runtime-cleanup-port` (`bin/cleanup-port.sh`) kills whatever is already listening on `$PORT` (or its first arg) before a dev server restarts, to avoid a stale watch process silently serving old code.
