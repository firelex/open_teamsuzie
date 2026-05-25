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
import { buildConvertToMarkdownTool } from '@teamsuzie/document-conversion';
import {
  DocumentVersionsStore, DOCUMENT_VERSIONS_MIGRATIONS,
} from '@teamsuzie/document-versions';
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
import { loadExtensions } from '../extensions/index.js';
import { createAiDraftRouter, createCoreAiDraftKinds } from './ai-draft.js';
import { createChatRouter } from './chat-route.js';
import { createFilesRouter, InMemoryFileStore } from './files-route.js';
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
  /** Default LLM target (baseUrl + apiKey + model). Wired into `/api/chat`;
   *  per-request `body.model` (Settings-page picker) overrides `.model`.
   *  `extraBody` is merged into every chat-completion request — use for
   *  provider-specific knobs (e.g. `{enable_thinking:false}` for Qwen). */
  agent?: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    systemPrompt?: string;
    extraBody?: Record<string, unknown>;
  };
  /** Directory to scan for extensions. Default './extensions' (relative to cwd). */
  extensionsDir?: string;
  /** Path to the build's public/static assets directory. Default './public'. */
  publicDir?: string;
  /**
   * Optional markitdown-agent target. When set (or when
   * `MARKITDOWN_AGENT_BASE_URL` env var is set), agent-runtime registers
   * `convert_to_markdown` (and `propose_document_edits` when
   * `modules.redline` is also enabled) so the model can read uploaded
   * DOCX/PDF attachments. When unset, those tools simply don't register.
   */
  markitdown?: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
  };
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
export async function createApp(opts: StartAgentOptions): Promise<AppHandles> {
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
      ...DOCUMENT_VERSIONS_MIGRATIONS,
    ],
  });

  const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
  const docStore = new InMemoryDocumentStore();
  const chats = new ChatsStore({ db });
  const workflowsStore = new WorkflowsStore({ db });
  const reviewsStore = new ReviewsStore({ db });
  const fileStore = new InMemoryFileStore();
  const versionsStore = new DocumentVersionsStore({ db });

  const personasDir = path.resolve(opts.personasDir ?? './personas');
  const personaRegistry = new PersonaRegistry({ filesystemDir: personasDir, db });

  // One-shot seed: copy file-based builtin personas into the owner's editable
  // store. Without this, the UI shows them as read-only builtins forever (the
  // PersonaEditor gates Edit/Delete on `source === 'user'`). Idempotent —
  // gated on a `personas_seeded` marker per owner, so safe to run every boot.
  try {
    personaRegistry.seedFromBuiltinsIfNeeded(OWNER_ID);
  } catch (err) {
    console.warn('[agent-runtime] persona seeding failed:',
      err instanceof Error ? err.message : err);
  }

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

  const markitdownBaseUrl = (opts.markitdown?.baseUrl
    ?? process.env.MARKITDOWN_AGENT_BASE_URL
    ?? '').replace(/\/$/, '');
  const markitdownFetch = opts.markitdown?.fetchImpl;

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
    publicDir: path.resolve(opts.publicDir ?? './public'),
  }));

  // ── Tool registry (core + extensions, Task 3.5.6) ─────────────────────
  // Core tools route through the registry so extensions can register more
  // via the same API. Currently only AI-draft consumes runChatTurn from
  // within agent-runtime and it intentionally passes `tools: []`; the
  // registry is the canonical source for any future tool-using endpoint.
  const toolRegistry = new ToolRegistry();
  for (const t of builtInTools) toolRegistry.register(t);

  // Conditional registration: convert_to_markdown is only useful when a
  // markitdown-agent is reachable. Without it the model would call the
  // tool and get an error on every invocation — better not to advertise.
  if (markitdownBaseUrl) {
    toolRegistry.register(buildConvertToMarkdownTool({
      fileStore,
      markitdownBaseUrl,
      fetchImpl: markitdownFetch,
    }));
  }

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

  // ── AI-draft kinds (core + extensions, Task 3.5.6) ────────────────────
  // Held here so extensions can register their own kinds onto it before the
  // router serves a request.
  const aiKinds = createCoreAiDraftKinds();

  // ── Extensions (Task 3.5.6) ───────────────────────────────────────────
  // Scan opts.extensionsDir (default './extensions') and route every
  // extension's modules / tools / aiDraftKinds through the same registries
  // as core code, tagged with { source: 'extension', extensionName: ... }.
  // Must run BEFORE registry.mount(app, ...) so extension-provided modules
  // can be mounted alongside core modules in a single pass.
  const extensionsDir = path.resolve(opts.extensionsDir ?? './extensions');
  const extensions = await loadExtensions(extensionsDir);
  for (const ext of extensions) {
    const meta = { source: 'extension' as const, extensionName: ext.name };
    for (const m of ext.modules ?? []) registry.register(m, meta);
    for (const t of ext.tools ?? []) toolRegistry.register(t, meta);
    for (const [kind, handler] of Object.entries(ext.aiDraftKinds ?? {})) {
      aiKinds.register(kind, handler, meta);
    }
    console.log(
      `[agent-runtime] loaded extension '${ext.name}': `
      + `${(ext.modules ?? []).length} modules, `
      + `${(ext.tools ?? []).length} tools, `
      + `${Object.keys(ext.aiDraftKinds ?? {}).length} aiDraftKinds`,
    );
  }

  // Build the mount flags. `resolveModules` covers the canonical module set
  // (history/library/personas/...); the raw `manifest.modules` may also
  // include extension module names (e.g. 'ext-mod': true) that aren't part
  // of the canonical schema. Merge so both core and extension flags resolve.
  const rawModuleFlags = (manifestStore.get().modules ?? {}) as Record<string, boolean>;
  const mountFlags: Record<string, boolean> = {
    ...rawModuleFlags,
    ...(resolveModules(manifestStore.get()) as unknown as Record<string, boolean>),
  };
  registry.mount(app, mountFlags);

  // ── /api/files (always) ───────────────────────────────────────────────
  // Per-session in-memory upload store + multipart router. Lifted from the
  // pre-runtime starter-external-agent files.ts (where it was duplicated
  // across every starter). The AssistantPage POSTs paperclip uploads here
  // and DELETEs them on removal; chat-route reads attachmentIds from the
  // body and inlines their content via buildAttachmentContext.
  app.use('/api', createFilesRouter({ store: fileStore, versionsStore }));

  // ── /api/chat (when an agent target is configured) ────────────────────
  // Chat completion + SSE stream. Per-request `body.model` (Settings-page
  // picker) overrides agent.model; persona-bound chats override further down.
  // Without opts.agent the route returns 503 so the AssistantPage's stream
  // reader can surface "no model configured" instead of swallowing a 404.
  if (opts.agent) {
    app.use('/api/chat', createChatRouter({
      agent: opts.agent,
      chats,
      personaRegistry,
      ownerId: OWNER_ID,
      workspaceId: 'assistant:default',
      defaultSystemPrompt: manifestStore.get().persona.systemPrompt,
      tools: toolRegistry.list(),
      toolCtx: { approvals, vectorDbBaseUrl: '' },
      fileStore,
      runChatTurn,
    }));
  } else {
    app.post('/api/chat', (_req, res) => {
      res.status(503).json({
        type: 'error',
        message: 'no chat agent configured (pass opts.agent to startAgent)',
      });
    });
  }

  // ── /api/ai/draft (always) ────────────────────────────────────────────
  // AI-fill helper. Reads manifest.ai.simpleModel at call time so a manifest
  // edit takes effect without a restart. Returns 503 when no model is set;
  // client AI-fill affordances should hide themselves accordingly.
  app.use('/api/ai/draft', createAiDraftRouter({
    get simpleModel() {
      const m = manifestStore.get().ai?.simpleModel;
      if (!m) return undefined;
      // Fall back to opts.agent for baseUrl/apiKey when the manifest omits
      // them. This lets agent.json declare only `model` (no credentials).
      const baseUrl = m.baseUrl ?? opts.agent?.baseUrl;
      if (!baseUrl) return undefined;
      return {
        baseUrl,
        apiKey: m.apiKey ?? opts.agent?.apiKey,
        model: m.model,
      };
    },
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
      markitdown: markitdownBaseUrl ? 'configured' : 'not configured',
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
  const { app } = await createApp(opts);
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
