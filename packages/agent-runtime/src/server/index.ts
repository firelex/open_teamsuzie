import 'dotenv/config';
import cors from 'cors';
import express, { type Express } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApprovalQueue, InMemoryApprovalStore } from '@teamsuzie/approvals';
import {
  CHATS_MIGRATIONS, ChatsStore, createChatsRouter,
} from '@teamsuzie/chats';
import { openDb } from '@teamsuzie/db-sqlite';
import { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import {
  applyPersona, createPersonasRouter, PERSONAS_MIGRATIONS, PersonaRegistry,
} from '@teamsuzie/personas';
import {
  createReviewsRouter, REVIEWS_MIGRATIONS, ReviewsStore,
} from '@teamsuzie/reviews';
import {
  createWorkflowsRouter, WORKFLOWS_MIGRATIONS, WorkflowsStore,
  type WorkflowSeed,
} from '@teamsuzie/workflows';
import {
  connectMcpServers, loadSkills, parseMcpConfigFile, runChatTurn,
  tools as builtInTools, type AnyToolDefinition, type ChatMessage,
  type McpManager, type SkillLoadResult, type ToolContext,
} from '@teamsuzie/agent-loop';
import {
  createPlatformRequestMiddleware, createWebhookRouter,
  registerWithPlatform, runWebhookChatTurn,
  type PlatformBridgeConfig,
} from '@teamsuzie/platform-bridge';

import {
  ManifestStore, resolveModules, listPersonas, findPersona,
  type AgentManifest, type ManifestTool,
} from '../manifest/index.js';
import { createAiDraftRouter, createCoreAiDraftKinds } from './ai-draft.js';
import { ModuleRegistry } from './module-registry.js';
import { createAvatarsRouter } from './personas-avatars.js';
import { ToolRegistry } from './tool-registry.js';

const OWNER_ID = 'agent-runtime-default';

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export interface StartAgentOptions {
  /** Path to agent.json, resolved relative to process.cwd() if relative. */
  manifestPath: string;
  /** Path to SQLite db. Default './data/agent.db'. */
  dbPath?: string;
  /** Path to a directory of PERSONA.md files; default './personas'. */
  personasDir?: string;
  /** Path to a workflows seed JSON file; default './workflows.seed.json'. */
  workflowsSeedPath?: string;
  /** Port (when actually listening). Default 3001. */
  port?: number;
  /** AGENT_DEV_AUTH equivalent — synthesize an admin session on every request. */
  devAuth?: boolean;
  /** Override the agent target (model/baseUrl). Pulled from process.env when omitted. */
  agent?: { baseUrl: string; apiKey?: string; model: string; systemPrompt?: string };
}

interface AppHandles {
  app: Express;
  close: () => Promise<void>;
}

/**
 * Build the Express app (no listen). Exported for tests; startAgent calls
 * this then binds a server. Every router beyond manifest/health is mounted
 * conditionally on manifest.modules.* so disabled modules return 404 and
 * the nav never points at a dead surface.
 */
export function createApp(opts: StartAgentOptions): AppHandles {
  const manifestPath = path.resolve(opts.manifestPath);
  const manifestStore = new ManifestStore(manifestPath);

  const dbPath = path.resolve(opts.dbPath ?? './data/agent.db');
  const db = openDb({
    path: dbPath,
    migrations: [
      ...CHATS_MIGRATIONS,
      ...PERSONAS_MIGRATIONS,
      ...WORKFLOWS_MIGRATIONS,
      ...REVIEWS_MIGRATIONS,
    ],
  });

  const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
  const docStore = new InMemoryDocumentStore();
  const chats = new ChatsStore({ db });
  const workflowsStore = new WorkflowsStore({ db });
  const reviewsStore = new ReviewsStore({ db });

  const personasDir = path.resolve(opts.personasDir ?? './personas');
  const personaRegistry = new PersonaRegistry({ filesystemDir: personasDir, db });

  // Seed workflows from disk as user-owned defaults (idempotent per manifest path).
  const seedPath = path.resolve(opts.workflowsSeedPath ?? './workflows.seed.json');
  try {
    if (existsSync(seedPath)) {
      const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as unknown;
      if (Array.isArray(seed)) {
        workflowsStore.seedAsUserIfEmpty(
          `workflows:${manifestPath}`, seed as WorkflowSeed[], OWNER_ID,
        );
      }
    }
  } catch (err) {
    console.warn(`[agent-runtime] workflows seed at ${seedPath} failed:`,
      err instanceof Error ? err.message : err);
  }

  const manifest = manifestStore.get();

  // Seed manifest.reviews.templates[] into reviews store as user-owned defaults
  // (idempotent per manifest path). User edits and deletes are preserved
  // across restarts — `seedAsUserIfEmpty` writes a marker on first apply.
  if (
    Array.isArray(manifest.reviews?.templates)
    && manifest.reviews.templates.length > 0
  ) {
    try {
      reviewsStore.seedAsUserIfEmpty(
        `reviews:${manifestPath}`, manifest.reviews.templates, OWNER_ID,
      );
    } catch (err) {
      console.warn('[agent-runtime] manifest.reviews.templates seed failed:',
        err instanceof Error ? err.message : err);
    }
  }

  // Seed manifest.prompts[] into workflows store as user-owned inline_chat entries.
  if (Array.isArray(manifest.prompts) && manifest.prompts.length > 0) {
    try {
      const promptSeeds: WorkflowSeed[] = manifest.prompts.map((p, i) => ({
        id: `manifest-prompt-${i}-${slugify(p.title)}`,
        name: p.title,
        description: p.subtitle ?? '',
        prompt: p.prompt ?? '',
        practiceAreas: p.practiceAreas ?? [],
        outputMode: 'inline_chat' as const,
        columnConfig: null,
        // Preserve the manifest's tile-on-Assistant-homepage semantic. The
        // manifest's `featured` is opt-in; treat undefined as true so the
        // pre-flag default of "all manifest prompts are tiles" is preserved.
        featured: p.featured ?? true,
      }));
      workflowsStore.seedAsUserIfEmpty(
        `prompts:${manifestPath}`, promptSeeds, OWNER_ID,
      );
    } catch (err) {
      console.warn('[agent-runtime] manifest.prompts seed failed:',
        err instanceof Error ? err.message : err);
    }
  }

  const app = express();
  app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*', credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createPlatformRequestMiddleware({
    platformToken: process.env.PLATFORM_TOKEN,
  }));
  if (opts.devAuth || process.env.AGENT_DEV_AUTH === 'true') {
    app.use('/api', injectDevSession(OWNER_ID));
  }
  app.use('/api', requireAgentSession());

  // ── /api/manifest (always) ────────────────────────────────────────────
  app.get('/api/manifest', (_req, res) => {
    res.json({ manifest: manifestStore.get() });
  });

  // ── /api/personas/avatars (always — must come before module routers) ───
  // Mounted unconditionally; /api/personas/* below is mounted by the
  // ModuleRegistry only when modules.personas is enabled. Express matches in
  // declaration order so /api/personas/avatars wins regardless.
  app.use('/api/personas/avatars', createAvatarsRouter({
    publicDir: path.resolve('./public'),
  }));

  // ── Tool registry (core + extensions, Task 3.5.6) ─────────────────────
  // Core tools route through the registry so extensions can register more
  // via the same API. Currently only AI-draft consumes runChatTurn from
  // within agent-runtime and it intentionally passes `tools: []`; the
  // registry is the canonical source for any future tool-using endpoint.
  const toolRegistry = new ToolRegistry();
  for (const t of builtInTools) toolRegistry.register(t);

  // ── Module routers (gated by manifest.modules.*) ──────────────────────
  // Disabled modules simply aren't mounted, so Express returns its default
  // 404 — which is what AC9 asks for and what the existing tests assert.
  const registry = new ModuleRegistry();
  registry.register({
    name: 'history',
    apiPrefix: '/api/chats',
    router: createChatsRouter({ store: chats, getWorkspaceId: () => 'assistant:default' }),
  });
  registry.register({
    name: 'personas',
    apiPrefix: '/api/personas',
    router: createPersonasRouter({
      registry: personaRegistry,
      getOwnerId: (req) => {
        const s = (req as unknown as { session?: { user?: { email?: string } } }).session;
        return s?.user?.email ?? null;
      },
    }),
  });
  registry.register({
    name: 'library',
    apiPrefix: '/api/workflows',
    router: createWorkflowsRouter({
      store: workflowsStore,
      getOwnerId: (req) => {
        const s = (req as unknown as { session?: { user?: { email?: string } } }).session;
        return s?.user?.email ?? null;
      },
    }),
  });
  registry.register({
    name: 'reviews',
    apiPrefix: '/api/reviews',
    router: createReviewsRouter({
      store: reviewsStore,
      getOwnerId: (req) => {
        const s = (req as unknown as { session?: { user?: { email?: string } } }).session;
        return s?.user?.email ?? null;
      },
    }),
  });
  registry.mount(app, resolveModules(manifestStore.get()) as unknown as Record<string, boolean>);

  // ── /api/ai/draft (always) ────────────────────────────────────────────
  // AI-fill helper. Reads manifest.ai.simpleModel at call time so a manifest
  // edit takes effect without a restart. Returns 503 when no model is set;
  // client AI-fill affordances should hide themselves accordingly.
  // The `aiKinds` registry is held here so Task 3.5.6 can register extension
  // kinds onto it before the router serves a request.
  const aiKinds = createCoreAiDraftKinds();
  app.use('/api/ai/draft', createAiDraftRouter({
    get simpleModel() { return manifestStore.get().ai?.simpleModel; },
    kinds: aiKinds,
    runTurn: async ({ messages, model, baseUrl, apiKey }) => {
      let text = '';
      const stream = runChatTurn({
        agent: { baseUrl, apiKey, model },
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [],
        toolCtx: {
          approvals,
          vectorDbBaseUrl: '',
        },
        maxIterations: 1,
      });
      for await (const event of stream) {
        if (event.type === 'chunk') text += event.text;
        else if (event.type === 'error') throw new Error(event.message);
      }
      return { text: text.trim() };
    },
  }));

  // ── /api/health ───────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    const m = manifestStore.get();
    res.json({
      status: 'ok',
      title: m.name,
      agent: { name: m.persona.name ?? m.persona.id, model: opts.agent?.model },
      tools: m.tools.filter((t) => t.enabled).map((t) => ({ name: t.name, description: t.description })),
      modules: resolveModules(m),
    });
  });

  // ── Warn at boot about advertised-but-unwired modules ─────────────────
  {
    const mods = resolveModules(manifestStore.get());
    const unwired: string[] = [];
    if (mods.matters) unwired.push('matters');
    if (mods.admin) unwired.push('admin');
    if (mods.billing) unwired.push('billing');
    if (mods.knowledgeBase) unwired.push('knowledgeBase');
    if (unwired.length > 0) {
      console.warn(
        `[agent-runtime] manifest enables modules with no router wired yet: ${unwired.join(', ')}. ` +
        `Nav will hide them until a panel is registered. See agent-runtime README.`,
      );
    }
  }

  return {
    app,
    close: async () => { manifestStore.close(); db.close?.(); },
  };
}

// ── Auth middleware (lifted verbatim from counsel) ──────────────────────

function requireAgentSession(): express.RequestHandler {
  return (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/webhook/')) return next();
    const session = (req as unknown as { session?: unknown }).session;
    if (!session) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    next();
  };
}

function injectDevSession(principalEmail: string): express.RequestHandler {
  return (req, _res, next) => {
    const r = req as unknown as { session?: unknown };
    if (!r.session) {
      r.session = { user: { email: principalEmail } };
    }
    next();
  };
}

// ── startAgent — production boot wrapper ────────────────────────────────

export async function startAgent(opts: StartAgentOptions): Promise<void> {
  const { app } = createApp(opts);
  // Reserved for future per-dir resolution; kept so the import isn't dead.
  void fileURLToPath(import.meta.url);
  const clientDistDir = path.resolve(process.cwd(), 'client', 'dist');
  // Serve client/dist if present (production).
  // Vite dev server handles dev; see omnibus starter's vite.config.ts proxy.
  if (existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
  }
  const port = opts.port ?? (Number(process.env.PORT) || 3001);
  app.listen(port, () => {
    console.log(`[agent-runtime] listening on http://localhost:${port}`);
  });
}
