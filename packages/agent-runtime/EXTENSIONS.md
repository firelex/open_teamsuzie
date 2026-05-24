# Authoring an agent-runtime extension

Extensions are the imperative escape hatch from `agent.json`. They live in
`extensions/<name>/` next to your `agent.json` and contribute to the runtime's
registries (Module, Tool, AiDraftKind).

## File layout

```
your-build/
  agent.json
  extensions/
    legal-research/
      index.ts              ← required
      courtlistener.ts      ← supporting files
      config.json           ← extension-local config (NEVER agent.json)
```

## Minimal extension

```ts
// extensions/hello/index.ts
import type { Extension } from '@teamsuzie/agent-runtime/extensions';

// `router` can be an express.Router OR a plain Express request handler
// (req, res, next) — Express's app.use(prefix, fn) accepts both.
// In environments where importing express is inconvenient (e.g. temp
// dirs in tests), a bare handler is the easiest approach.
const handler: import('express').RequestHandler = (req, res, next) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.json({ from: 'hello-extension' });
    return;
  }
  next();
};

export default {
  name: 'hello',
  modules: [{ name: 'hello', apiPrefix: '/api/hello', router: handler }],
  tools: [{
    name: 'shout',
    description: 'Uppercases its input',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    execute: async ({ text }) => String(text).toUpperCase(),
  }],
  aiDraftKinds: {
    'hello-greeting': {
      systemPromptFor: (ctx) =>
        `Draft a friendly greeting to "${(ctx as any).name ?? 'world'}".`,
    },
  },
} satisfies Extension;
```

## Mounting

`createApp` (called internally by `startAgent`) scans `extensionsDir`
(default `./extensions` relative to `process.cwd()`) at boot,
dynamic-imports each `extensions/<name>/index.{mjs,js,ts}` (tried in that
order), and routes its contributions through the same registries as core code.
Each registration is tagged `source: 'extension', extensionName: '<name>'`.

To enable an extension-provided module at runtime, add its module `name` to
`manifest.modules` in `agent.json` (e.g. `"hello": true`). Modules not listed
in `manifest.modules` — or listed with value `false` — are not mounted; their
routes return 404.

## Rules

- Extensions never mutate `agent.json`. Use `extensions/<name>/config.json` for
  extension-local config.
- Extension `name` must be unique within a build.
- Extension modules must not collide with core module names (`library`,
  `personas`, `history`, `settings`, `assistant`, `reviews`, plus future core
  modules).
- Extensions are loaded sequentially; ordering is deterministic by directory
  name (alphabetical, via `readdirSync`).
- Last-write wins: if a core registration and an extension registration share
  the same kind/name, the later one (extension, by virtue of loading after core)
  takes precedence.

## Type contract

```ts
interface Extension {
  name: string;
  version?: string;
  modules?: ModuleSpec[];
  tools?: AnyToolDefinition[];
  aiDraftKinds?: Record<string, AiDraftKindHandler>;
  seeds?: Record<string, unknown[]>;
}

// ModuleSpec.router is typed as express.Router, but Express's app.use()
// also accepts a plain (req, res, next) handler — both work at runtime.
interface ModuleSpec {
  name: string;
  router?: import('express').Router;
  apiPrefix?: string;  // defaults to '/api/<name>'
}

interface AiDraftKindHandler {
  systemPromptFor: (context: Record<string, unknown>) => string;
}
```

## Build / packaging

The loader resolves candidates in this order: `index.mjs`, `index.js`,
`index.ts`. In production, ship extensions as `.mjs` or `.js`. In dev with a
TypeScript runtime (e.g. `tsx`), `.ts` works too — but plain Node won't eval
TS, so prefer `.mjs` for portability.

If your extension needs npm dependencies, install them at the build root (not
inside the extension dir). Node's resolution will walk up from the extension's
directory to find them.

Note: if you write an extension in a temp dir or other location outside any
npm package tree, you cannot `import express` from the extension file because
Node's module resolver won't find it. Use a bare `(req, res, next)` handler
instead — `app.use(prefix, fn)` accepts both.

## Reference

The full extension SDK is exported from `@teamsuzie/agent-runtime/extensions`:

```ts
import type {
  Extension,
  AiDraftKindHandler,
  RegistrationMeta,
} from '@teamsuzie/agent-runtime/extensions';
import { loadExtensions } from '@teamsuzie/agent-runtime/extensions';
```

`loadExtensions(dir)` is the loader the runtime uses internally; it's exposed
so tools / tests can pre-validate an extension dir.
