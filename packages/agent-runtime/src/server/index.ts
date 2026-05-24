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
    migrations: [...CHATS_MIGRATIONS, ...PERSONAS_MIGRATIONS, ...WORKFLOWS_MIGRATIONS],
  });

  const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
  const docStore = new InMemoryDocumentStore();
  const chats = new ChatsStore({ db });
  const workflowsStore = new WorkflowsStore({ db });

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

  // Seed manifest.prompts[] into workflows store as user-owned inline_chat entries.
  const manifest = manifestStore.get();
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

  // ── Conditional routers ───────────────────────────────────────────────
  app.use((req, res, next) => {
    const mods = resolveModules(manifestStore.get());
    const advertise = (flag: boolean, prefix: string) => {
      if (req.path.startsWith(prefix) && !flag) {
        res.status(404).json({ error: 'module_disabled', module: prefix });
        return true;
      }
      return false;
    };
    if (advertise(mods.history, '/api/chats')) return;
    if (advertise(mods.personas, '/api/personas')) return;
    if (advertise(mods.library, '/api/workflows')) return;
    next();
  });

  app.use('/api/chats',
    createChatsRouter({ store: chats, getWorkspaceId: () => 'assistant:default' }));

  app.use('/api/personas',
    createPersonasRouter({
      registry: personaRegistry,
      getOwnerId: (req) => {
        const s = (req as unknown as { session?: { user?: { email?: string } } }).session;
        return s?.user?.email ?? null;
      },
    }));

  app.use('/api/workflows',
    createWorkflowsRouter({
      store: workflowsStore,
      getOwnerId: (req) => {
        const s = (req as unknown as { session?: { user?: { email?: string } } }).session;
        return s?.user?.email ?? null;
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
    if (mods.reviews) unwired.push('reviews');
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
