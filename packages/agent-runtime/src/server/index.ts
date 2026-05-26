import 'dotenv/config';
import cors from 'cors';
import express, { type Express } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

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
  createReviewsRouter as createGridReviewsRouter,
  REVIEWS_MIGRATIONS as GRID_REVIEWS_MIGRATIONS,
  ReviewsStore as GridReviewsStore,
} from '@teamsuzie/grid-review';
import {
  DocumentVersionsStore, DOCUMENT_VERSIONS_MIGRATIONS,
} from '@teamsuzie/document-versions';
import {
  createWorkspacesRouter, WORKSPACES_MIGRATIONS, WorkspacesStore,
} from '@teamsuzie/workspaces';
import { MembersStore, SHARING_MIGRATIONS } from '@teamsuzie/sharing';
import {
  backfillMatterOwnership, createMatterMembersRouter,
  createMatterMetadataRouter, createMatterUploadsRouter,
  createRequireMatterAccess, createReviewsExportRouter,
  createReviewsFromWorkflowRouter, MATTERS_METADATA_MIGRATIONS,
  MatterMetadataStore, SUBJECT_MATTER,
} from '@teamsuzie/matters';
import { buildProposeDocumentEditsTool } from '@teamsuzie/docx';
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
import { buildDocumentTools } from './document-tools.js';
import { createDocumentsRouter } from './documents-router.js';
import { createFilesRouter, InMemoryFileStore } from './files-route.js';
import { buildLocalRunCellAdapter } from './local-run-adapter.js';
import { ModuleRegistry } from './module-registry.js';
import { createRedlineRouter } from './redline-router.js';
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
  /**
   * Directory for the file-store's disk persistence. Default:
   * `<dbPath dir>/files`. Set to `null` to opt out of persistence
   * (in-memory only — files won't survive a restart). Pass an
   * explicit path if you want files separate from the db dir.
   */
  filesDataDir?: string | null;
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
      ...WORKSPACES_MIGRATIONS,
      ...SHARING_MIGRATIONS,
      ...GRID_REVIEWS_MIGRATIONS,
      ...MATTERS_METADATA_MIGRATIONS,
    ],
  });

  const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
  const docStore = new InMemoryDocumentStore();
  const chats = new ChatsStore({ db });
  const workflowsStore = new WorkflowsStore({ db });
  const reviewsStore = new ReviewsStore({ db });
  // Default to a `files/` directory next to the SQLite db so uploads
  // survive process restarts alongside the rows that reference them
  // (workspace_documents.external_doc_id is opaque — the file bucket
  // is the source of truth for bytes). Hosts can pass
  // `opts.filesDataDir: null` to opt out (e.g. one-shot demo builds
  // where files shouldn't outlive the process).
  const defaultFilesDataDir = path.join(path.dirname(dbPath), 'files');
  const filesDataDir =
    opts.filesDataDir === null
      ? null
      : (opts.filesDataDir ?? defaultFilesDataDir);
  const fileStore = new InMemoryFileStore({ dataDir: filesDataDir });
  const versionsStore = new DocumentVersionsStore({ db });
  const workspacesStore = new WorkspacesStore({ db });
  const membersStore = new MembersStore({ db });
  const gridReviewsStore = new GridReviewsStore({ db });
  const matterMetadataStore = new MatterMetadataStore({ db });

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

  // CORS allowlist: in production a single ALLOWED_ORIGIN is the norm; for
  // SuzieCode-hosted previews we accept a comma-separated list via
  // AGENT_ALLOWED_ORIGINS (typically the SuzieCode UI's localhost origin).
  // We only fall back to '*' if neither is set AND no local token is wired —
  // a permissive default + no token combination is loudly insecure and was
  // already flagged in security review, so we now require an explicit opt-in.
  const allowedOriginsList = (process.env.AGENT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowedOriginEnv = process.env.ALLOWED_ORIGIN;
  const localToken = process.env.AGENT_LOCAL_TOKEN || '';
  const corsOrigin: cors.CorsOptions['origin'] = allowedOriginsList.length > 0
    ? (origin, cb) => {
        if (!origin || allowedOriginsList.includes(origin)) cb(null, true);
        else cb(new Error('CORS: origin not allowed'));
      }
    : (allowedOriginEnv || '*');
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  // Server-side Origin allowlist (defense-in-depth above browser CORS): the
  // cors() middleware sets Access-Control-Allow-Origin so a malicious page
  // can't *read* responses, but the request itself still reaches the server
  // for non-preflighted methods (simple GETs, image-style requests). Reject
  // here too so side-effecting routes never execute for foreign origins.
  // /api/health stays open: SuzieCode polls it before the iframe loads.
  if (allowedOriginsList.length > 0) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path.startsWith('/webhook/')) return next();
      const origin = req.headers.origin as string | undefined;
      if (origin && !allowedOriginsList.includes(origin)) {
        res.status(403).json({ error: 'origin not allowed' });
        return;
      }
      next();
    });
  }

  app.use('/api', createPlatformRequestMiddleware({
    platformToken: process.env.PLATFORM_TOKEN,
  }));

  // When AGENT_LOCAL_TOKEN is set, require it on every /api request as a
  // CSRF-style proof-of-UI-origin (the dev counterpart to PLATFORM_TOKEN).
  // Default-off because the SuzieCode iframe makes same-origin /api calls
  // that don't carry the token; that case relies on the Origin allowlist
  // above. Useful for non-iframe deployments (e.g. a thick client proxy).
  if (localToken) {
    app.use('/api', requireLocalToken(localToken));
  }

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

  // `convert_to_markdown` + navigation tools come from the per-turn
  // `buildDocumentTools` bundle below (which the chat-route invokes with
  // the live sessionId). Drafting tools are gated on `modules.drafting`.

  const redlineEnabled = Boolean(manifest.modules?.redline);
  const draftingEnabled = Boolean(manifest.modules?.drafting);
  if (markitdownBaseUrl && redlineEnabled) {
    toolRegistry.register(buildProposeDocumentEditsTool({
      fileStore,
      versionsStore: {
        addVersion: (input) => versionsStore.addVersion(input) as { id: string },
      },
      author: manifest.persona.name ?? manifest.name ?? 'AI assistant',
      buildDownloadUrl: (sid, fid) =>
        `/api/files/${encodeURIComponent(sid)}/${encodeURIComponent(fid)}/content`,
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
  if (markitdownBaseUrl) {
    registry.register({
      name: 'redline',
      apiPrefix: '/api/files',
      router: createRedlineRouter({ fileStore, versionsStore }),
    });
  }

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

  // ── /api/matters (gated by modules.matters) ───────────────────────────
  // Composes @teamsuzie/workspaces (matter rows + folders + doc refs),
  // @teamsuzie/sharing (member rows), @teamsuzie/chats (matter-scoped
  // chats), and the file store (bucket = matterId) into the matter
  // surface. Order matters: shadow create/list go first so they win
  // over the generic workspaces router; requireMatterAccess gates every
  // nested /:matterId/* path before the sub-routers see it.
  if (resolveModules(manifestStore.get()).matters) {
    const getSessionUser = (req: express.Request) => {
      const s = (req as unknown as { session?: { user?: { email?: string } } }).session;
      return s?.user?.email ? { email: s.user.email } : null;
    };

    // One-shot demo bridge: grant the dev user owner on every matter
    // that has no member row, so matters created before membership
    // existed remain reachable. Multi-user production deployments
    // should skip this (real auth handles ownership at creation time).
    if (opts.devAuth || process.env.AGENT_DEV_AUTH === 'true') {
      try {
        const result = backfillMatterOwnership({
          members: membersStore,
          workspaces: workspacesStore,
          ownerEmail: OWNER_ID,
        });
        if (result.granted > 0) {
          console.log(
            `[agent-runtime] backfilled ${result.granted} matter owner row(s) for ${OWNER_ID}`,
          );
        }
      } catch (err) {
        console.warn('[agent-runtime] matter ownership backfill failed:',
          err instanceof Error ? err.message : err);
      }
    }

    // Shadow POST /api/matters — creates the workspace, grants the
    // session user owner, and (when the body carries typeId /
    // customFields) seeds the metadata row in one call. The workspaces
    // router has no hook for post-create work, and we don't want to add
    // one upstream until a real multi-user need shows up. Metadata
    // shape is validated by the host's UI before POST; the route
    // accepts whatever the client sends, mirroring the metadata router.
    app.post('/api/matters', (req, res) => {
      const user = getSessionUser(req);
      if (!user?.email) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      const body = req.body as Record<string, unknown> | undefined;
      const name = String(body?.name || '').trim();
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const descriptionInput = body?.description;
      const description =
        typeof descriptionInput === 'string' ? descriptionInput.trim() : '';
      const created = workspacesStore.createWorkspace({
        name,
        description: description.length > 0 ? description : null,
      });
      membersStore.addMember({
        subjectType: SUBJECT_MATTER,
        subjectId: created.id,
        userId: user.email,
        role: 'owner',
        grantedBy: user.email,
      });
      // Seed metadata when the create payload carries any of it. A
      // missing typeId stays null (untyped); a missing customFields
      // blob stays {}. We only write when at least one of them is
      // present so untyped builds don't acquire empty rows.
      const typeIdRaw = body?.typeId;
      const customFieldsRaw = body?.customFields;
      const wantsMetadata =
        (typeof typeIdRaw === 'string' && typeIdRaw.trim().length > 0) ||
        (customFieldsRaw && typeof customFieldsRaw === 'object' && !Array.isArray(customFieldsRaw));
      let metadata = null;
      if (wantsMetadata) {
        const typeId =
          typeof typeIdRaw === 'string' && typeIdRaw.trim().length > 0
            ? typeIdRaw.trim()
            : null;
        const customFields =
          customFieldsRaw && typeof customFieldsRaw === 'object' && !Array.isArray(customFieldsRaw)
            ? (customFieldsRaw as Record<string, unknown>)
            : {};
        metadata = matterMetadataStore.upsert({
          matterId: created.id,
          typeId,
          customFields,
        });
      }
      res.status(201).json({ item: created, metadata });
    });

    // Shadow GET /api/matters — filter the workspaces list to matters
    // the session user has any role on, and embed metadata so the
    // type-grouped sidebar can render without an N+1 fetch. The
    // generic workspaces router (mounted below) still serves the
    // per-id and folder/document routes, which inherit
    // requireMatterAccess via the :matterId mount.
    app.get('/api/matters', (req, res) => {
      const user = getSessionUser(req);
      if (!user?.email) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      const includeArchived = req.query.archived === 'true';
      const accessible = workspacesStore
        .listWorkspaces({ includeArchived })
        .filter(
          (w) =>
            membersStore.getRole({ type: SUBJECT_MATTER, id: w.id }, user.email!) !== null,
        )
        .map((w) => {
          const m = matterMetadataStore.get(w.id);
          return m ? { ...w, metadata: m } : w;
        });
      res.json({ items: accessible });
    });

    // Every /:matterId/* path gates on membership.
    app.use(
      '/api/matters/:matterId',
      createRequireMatterAccess({
        members: membersStore,
        workspaces: workspacesStore,
        getSessionUser,
      }),
    );

    // Members CRUD — owner-only mutate, any-member read.
    app.use(
      '/api/matters/:matterId/members',
      createMatterMembersRouter({
        members: membersStore,
        workspaces: workspacesStore,
        getSessionUser,
      }),
    );

    // Type + custom-field values for one matter. requireMatterAccess
    // already gates the parent path so any role can read; any role can
    // write too — host UI gates the write surface separately if it
    // wants to be stricter.
    app.use(
      '/api/matters/:matterId/metadata',
      (req, _res, next) => {
        (req as unknown as { _matterId?: string })._matterId = String(
          req.params.matterId ?? '',
        );
        next();
      },
      createMatterMetadataRouter({ metadata: matterMetadataStore }),
    );

    // Matter-scoped chats — same chats store, workspace_id = matterId.
    // Express 5 doesn't merge parent params into a sub-router by default,
    // so the chats router can't read `:matterId` directly. Stash it on the
    // request object first; the chats router pulls it via getWorkspaceId.
    app.use(
      '/api/matters/:matterId/chats',
      (req, _res, next) => {
        (req as unknown as { _matterId?: string })._matterId = String(
          req.params.matterId ?? '',
        );
        next();
      },
      createChatsRouter({
        store: chats,
        getWorkspaceId: (req) =>
          (req as unknown as { _matterId?: string })._matterId ?? '',
      }),
    );

    // Matter-scoped grid reviews — tabular document review (rows=docs,
    // columns=prompts, cells=LLM-generated answers). Lights up only when
    // both modules.matters and modules.reviews are on, so a build can
    // pick the matter surface without auto-mounting the library-page
    // reviews (which uses the unrelated @teamsuzie/reviews package on
    // /api/reviews).
    //
    // Same Express-5 parent-params caveat as the chats mount above —
    // stash matterId before the sub-router so getWorkspaceId can read it.
    //
    // runAdapter is intentionally omitted: matter-doc cell-running needs
    // a KB run-adapter (buildRagRunCellAdapter in @teamsuzie/grid-review-rag)
    // which depends on the vector-db not yet wired into agent-runtime
    // (see docs/GAPS.md #5). Without it, POST /:reviewId/run returns
    // 501 from the package — every other CRUD route works.
    if (resolveModules(manifestStore.get()).reviews) {
      // Review-bound chats — separate workspace_id namespace (`review:<id>`)
      // so a chat anchored to a review doesn't show up in the matter's
      // top-level chats list and vice versa. Mounted at a deeper prefix
      // than the reviews router below so it wins for /:reviewId/chats.
      // Verifies the review actually belongs to the matter to keep one
      // matter's owner from poking at another matter's review chats.
      app.use(
        '/api/matters/:matterId/reviews/:reviewId/chats',
        (req, res, next) => {
          const matterId = String(req.params.matterId ?? '');
          const reviewId = String(req.params.reviewId ?? '');
          const review = gridReviewsStore.getReview(reviewId);
          if (!review || review.workspaceId !== matterId) {
            res.status(404).json({ error: 'review not found' });
            return;
          }
          (req as unknown as { _reviewWorkspaceId?: string })._reviewWorkspaceId =
            `review:${reviewId}`;
          next();
        },
        createChatsRouter({
          store: chats,
          getWorkspaceId: (req) =>
            (req as unknown as { _reviewWorkspaceId?: string })._reviewWorkspaceId ?? '',
        }),
      );

      // xlsx export — mount before the generic reviews router so its
      // `/:reviewId/export.xlsx` matches first. Same _matterId stash so
      // the export router can read the parent param under Express 5.
      app.use(
        '/api/matters/:matterId/reviews',
        (req, _res, next) => {
          (req as unknown as { _matterId?: string })._matterId = String(
            req.params.matterId ?? '',
          );
          next();
        },
        createReviewsExportRouter({
          reviews: gridReviewsStore,
          workspaces: workspacesStore,
        }),
        createReviewsFromWorkflowRouter({
          reviews: gridReviewsStore,
          workspaces: workspacesStore,
          workflows: workflowsStore,
          getSessionUser,
        }),
        createGridReviewsRouter({
          store: gridReviewsStore,
          getWorkspaceId: (req) =>
            (req as unknown as { _matterId?: string })._matterId ?? '',
          // Wire the local (non-KB) run adapter when both prerequisites
          // are configured. Without an opts.agent the chat surface is
          // also down (so cells couldn't run anyway); without
          // markitdownBaseUrl conversion would fail at runtime, so we
          // gate at boot rather than per-call. When either is missing
          // the package's default 501 stays — host UI surfaces a toast.
          ...(opts.agent && markitdownBaseUrl
            ? {
                runAdapter: buildLocalRunCellAdapter({
                  fileStore,
                  markitdownBaseUrl,
                  agent: opts.agent,
                  fetchImpl: markitdownFetch,
                }),
              }
            : {}),
        }),
      );
    }

    // Multipart upload → file bucket (matterId) + workspace_documents row.
    app.use(
      '/api/matters',
      createMatterUploadsRouter({
        fileStore,
        workspaces: workspacesStore,
        documentVersions: versionsStore,
        maxUploadBytes: 25 * 1024 * 1024,
      }),
    );

    // Generic workspaces router — handles PATCH/archive/delete plus
    // folders + documents under /:id. Mounted last so the shadow GET/POST
    // and matter-uploads above win for their specific paths.
    app.use(
      '/api/matters',
      createWorkspacesRouter({
        store: workspacesStore,
        onDocumentRemoved: (workspace, doc) => {
          // Cascade: file bytes follow the workspace_documents row, so
          // re-uploading the same file produces a fresh fileId instead
          // of orphaning the original bytes.
          fileStore.delete(workspace.id, doc.externalDocId);
        },
        onWorkspaceRemoved: (workspaceId) => {
          membersStore.removeMembersFor({ type: SUBJECT_MATTER, id: workspaceId });
          // Grid-review schema has no cross-package FK to workspaces, so
          // cascade explicitly: list every review in the matter and
          // delete it (within-review rows cascade via the package's own
          // FKs). Idempotent — a no-reviews matter walks an empty list.
          for (const r of gridReviewsStore.listReviews(workspaceId)) {
            gridReviewsStore.deleteReview(r.id);
          }
          // Metadata row's FK already cascades on workspace delete; the
          // explicit call is a no-op safety net for hosts that swap in
          // a store without FK enforcement (PRAGMA foreign_keys=OFF, etc.)
          matterMetadataStore.delete(workspaceId);
        },
      }),
    );
  }

  // ── /api/files (always) ───────────────────────────────────────────────
  // Per-session in-memory upload store + multipart router. Lifted from the
  // pre-runtime starter-external-agent files.ts (where it was duplicated
  // across every starter). The AssistantPage POSTs paperclip uploads here
  // and DELETEs them on removal; chat-route reads attachmentIds from the
  // body and inlines their content via buildAttachmentContext.
  // Gate per-bucket file routes (read / content / delete / upload-with-
  // sessionId / promote) on bucket-shape-aware ownership. Without this,
  // a logged-in user could read another user's matter bytes by guessing
  // the matter id. The bucket key shapes the agent-runtime mints:
  //   - `assistant:<email>`   — top-level chat session for that user
  //   - `<matterId>`          — matter docs
  //   - `review:<reviewId>`   — review-bound chat session
  //   - `<chatId>` (UUID)     — pre-promote bare-route tab session, or
  //                             persisted chat (workspaceId carries the
  //                             real ownership signal)
  //   - tab UUID              — a tab-local session that hasn't been
  //                             promoted yet (no user binding stored)
  app.use(
    '/api',
    createFilesRouter({
      store: fileStore,
      versionsStore,
      canAccessBucket: (req, bucket) => {
        const session = (req as unknown as {
          session?: { user?: { email?: string } };
        }).session;
        const userEmail = session?.user?.email;
        if (!userEmail) {
          return { allowed: false, status: 401, message: 'unauthenticated' };
        }

        // assistant:<email> — only the matching email reads its bucket.
        if (bucket.startsWith('assistant:')) {
          const owner = bucket.slice('assistant:'.length).toLowerCase();
          return owner === userEmail.toLowerCase()
            ? { allowed: true }
            : { allowed: false, status: 403, message: 'forbidden' };
        }

        // review:<reviewId> — require access to the underlying matter.
        if (bucket.startsWith('review:')) {
          const reviewId = bucket.slice('review:'.length);
          const review = gridReviewsStore.getReview(reviewId);
          if (!review) {
            return { allowed: false, status: 404, message: 'not_found' };
          }
          const role = membersStore.getRole(
            { type: SUBJECT_MATTER, id: review.workspaceId },
            userEmail,
          );
          return role
            ? { allowed: true }
            : { allowed: false, status: 403, message: 'forbidden' };
        }

        // Bare matter bucket — membership required.
        if (workspacesStore.getWorkspace(bucket)) {
          const role = membersStore.getRole(
            { type: SUBJECT_MATTER, id: bucket },
            userEmail,
          );
          return role
            ? { allowed: true }
            : { allowed: false, status: 403, message: 'forbidden' };
        }

        // Persisted chat bucket — read the chat row's workspace_id and
        // recurse against its semantics.
        const chat = chats.getChat(bucket);
        if (chat) {
          const ws = chat.workspaceId;
          if (ws === `assistant:${userEmail}`) return { allowed: true };
          if (ws.startsWith('review:')) {
            const reviewId = ws.slice('review:'.length);
            const review = gridReviewsStore.getReview(reviewId);
            if (review) {
              const role = membersStore.getRole(
                { type: SUBJECT_MATTER, id: review.workspaceId },
                userEmail,
              );
              if (role) return { allowed: true };
            }
            return { allowed: false, status: 403, message: 'forbidden' };
          }
          if (workspacesStore.getWorkspace(ws)) {
            const role = membersStore.getRole(
              { type: SUBJECT_MATTER, id: ws },
              userEmail,
            );
            if (role) return { allowed: true };
            return { allowed: false, status: 403, message: 'forbidden' };
          }
          return { allowed: false, status: 403, message: 'forbidden' };
        }

        // Unrecognised bucket — bare-route tab session that hasn't been
        // promoted (yet). The session that uploaded the file is already
        // in this user's tab; we don't have a tab→user index, so we
        // can't authenticate the bucket directly. Two policies:
        //   - Permissive (legacy): allow any authenticated caller through
        //     and rely on the promote step to re-key into a real bucket.
        //     This is fine when sessions are unforgeable, but under
        //     AGENT_DEV_AUTH=true every caller IS the user, so a local
        //     page could enumerate buckets by id.
        //   - Strict: only allow when the request also proves UI origin —
        //     via PLATFORM_TOKEN, AGENT_LOCAL_TOKEN, or an allow-listed
        //     Origin. Under dev-auth, fall through to deny unknown ids.
        const devAuthOn = process.env.AGENT_DEV_AUTH === 'true';
        if (!devAuthOn) {
          return { allowed: true };
        }
        // Dev-auth mode: require one of the local proofs-of-UI before
        // letting unknown bucket ids through.
        const origin = req.headers.origin as string | undefined;
        const allowedOrigins = (process.env.AGENT_ALLOWED_ORIGINS || '')
          .split(',').map((o) => o.trim()).filter(Boolean);
        const originOk = origin && allowedOrigins.length > 0
          && allowedOrigins.includes(origin);
        const localTokenEnv = process.env.AGENT_LOCAL_TOKEN || '';
        const providedHeader = req.headers['x-suziecode-token'];
        const provided = Array.isArray(providedHeader)
          ? providedHeader[0]
          : providedHeader;
        const tokenOk = !!localTokenEnv && provided === localTokenEnv;
        if (originOk || tokenOk) return { allowed: true };
        return { allowed: false, status: 403, message: 'forbidden' };
      },
    }),
  );

  // User-driven document endpoints (counterparts to the model-driven
  // tools). Always mounted; absent prerequisites surface as 503/404.
  //   - /api/documents/:sessionId/:docId/export — export_to_docx
  //   - /api/documents/compare/summary         — streaming SSE topic
  //     synthesis backing CompareTable. Uses the manifest's simpleModel
  //     (resolved per-request via the closure below so manifest edits
  //     take effect without a restart).
  app.use('/api/documents', createDocumentsRouter({
    fileStore, docStore, markitdownBaseUrl, fetchImpl: markitdownFetch,
    resolveSummaryModel: () => {
      const m = manifestStore.get().ai?.simpleModel;
      if (!m) return null;
      const baseUrl = m.baseUrl ?? opts.agent?.baseUrl;
      if (!baseUrl) return null;
      return {
        baseUrl,
        apiKey: m.apiKey ?? opts.agent?.apiKey,
        model: m.model,
        // Inherit provider knobs from the main agent — without this,
        // Qwen models default to thinking-on and the summary call sits
        // in an internal reasoning loop for minutes before emitting
        // any output, which kills the streaming UX.
        ...(opts.agent?.extraBody ? { extraBody: opts.agent.extraBody } : {}),
      };
    },
    runChatTurn,
    toolCtx: { approvals, vectorDbBaseUrl: '' },
  }));

  // ── /api/chat (when an agent target is configured) ────────────────────
  // Chat completion + SSE stream. Per-request `body.model` (Settings-page
  // picker) overrides agent.model; persona-bound chats override further down.
  // Without opts.agent the route returns 503 so the AssistantPage's stream
  // reader can surface "no model configured" instead of swallowing a 404.
  if (opts.agent) {
    // Compare-documents topic synthesis runs as an SSE stream from the
    // /api/documents/compare/summary endpoint (mounted above), not as
    // a synchronous tool callback — the user sees topics fill in
    // progressively rather than waiting for the full set. The tool
    // itself returns fast (mechanical diff only); the model uses the
    // diff markdown for its prose reply.
    app.use('/api/chat', createChatRouter({
      agent: opts.agent,
      chats,
      personaRegistry,
      ownerId: OWNER_ID,
      workspaceId: 'assistant:default',
      defaultSystemPrompt: manifestStore.get().persona.systemPrompt,
      tools: toolRegistry.list(),
      buildPerTurnTools: (sessionId) => buildDocumentTools({
        sessionId,
        fileStore,
        docStore,
        markitdownBaseUrl,
        fetchImpl: markitdownFetch,
        includeDrafting: draftingEnabled,
      }),
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
        agent: {
          baseUrl, apiKey, model,
          // Inherit provider knobs from the main agent so Qwen
          // thinking-on (or similar) doesn't make AI-fill calls hang.
          ...(opts.agent?.extraBody ? { extraBody: opts.agent.extraBody } : {}),
        },
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

/**
 * Per-boot local-API token. When the runtime is hosted by SuzieCode in a
 * preview iframe, AGENT_DEV_AUTH=true skips real auth, so anything that can
 * reach the port can act as the user. The local token (also forwarded from
 * SuzieCode via env) restores a "proves request came from the parent UI"
 * check: SuzieCode's vite proxy injects the same X-SuzieCode-Token header
 * on its end, so the preview only answers requests routed through the
 * proxy. SSE/EventSource callers can pass it as ?token=… since
 * EventSource can't set custom headers.
 *
 * /api/health stays open: SuzieCode polls it from outside the proxy to
 * decide when the preview is ready.
 */
function requireLocalToken(expected: string): express.RequestHandler {
  // Pre-encode to avoid re-allocating on every request.
  const expectedBuf = Buffer.from(expected);
  return (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/webhook/')) return next();
    const header = req.headers['x-suziecode-token'];
    const provided = Array.isArray(header) ? header[0] : header;
    const fallback = typeof req.query.token === 'string' ? req.query.token : undefined;
    const candidate = provided || fallback;
    if (!candidate || candidate.length !== expected.length) {
      res.status(403).json({ error: 'missing or invalid local token' });
      return;
    }
    try {
      const ok = timingSafeEqual(Buffer.from(candidate), expectedBuf);
      if (!ok) {
        res.status(403).json({ error: 'missing or invalid local token' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'missing or invalid local token' });
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

// Public re-exports of the chat router so downstream apps (e.g. SuzieCode's
// build-scoped chat) can mount the same Express router with their own tools
// without re-implementing the streaming protocol.
export { createChatRouter } from './chat-route.js';
export type { CreateChatRouterDeps } from './chat-route.js';
