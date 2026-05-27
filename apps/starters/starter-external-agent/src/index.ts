import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalQueue, InMemoryApprovalStore } from '@teamsuzie/approvals';
import {
  connectMcpServers,
  loadSkills,
  parseMcpConfigFile,
  runChatTurn,
  tools as builtInTools,
  type AnyToolDefinition,
  type ChatMessage,
  type McpManager,
  type SkillLoadResult,
  type ToolContext,
} from '@teamsuzie/agent-loop';
import { CHATS_MIGRATIONS, ChatsStore, createChatsRouter } from '@teamsuzie/chats';
import { openDb } from '@teamsuzie/db-sqlite';
import { InMemoryDocumentStore } from '@teamsuzie/markdown-document';
import { applyPersona, PersonaRegistry } from '@teamsuzie/personas';
import {
  createPlatformRequestMiddleware,
  createWebhookRouter,
  registerWithPlatform,
  runWebhookChatTurn,
  type PlatformBridgeConfig,
} from '@teamsuzie/platform-bridge';
import { config } from './config.js';
import {
  buildAttachmentContext,
  createFilesRouter,
  InMemoryFileStore,
} from './files.js';
import { buildDocumentTools } from './document-tools.js';
import { injectDevSession, requireAgentSession } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, '../client/dist');

const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
const fileStore = new InMemoryFileStore();
const docStore = new InMemoryDocumentStore();

const db = openDb({
  path: config.db.path,
  migrations: [...CHATS_MIGRATIONS],
});
const chats = new ChatsStore({ db });
const ASSISTANT_WORKSPACE_ID = 'assistant:default';

let skillState: SkillLoadResult = { skills: [], systemPrompt: '', derivedHosts: [] };
let mcp: McpManager = { tools: [], status: [], shutdown: async () => {} };

const personaRegistry = new PersonaRegistry({ filesystemDir: config.personas.dir });
if (personaRegistry.listBuiltins().length > 0) {
  console.log(
    `Loaded ${personaRegistry.listBuiltins().length} builtin persona(s): ${personaRegistry
      .listBuiltins()
      .map((p) => p.id)
      .join(', ')}`,
  );
}

function activeTools(): AnyToolDefinition[] {
  return [...builtInTools, ...mcp.tools];
}

async function bootstrapMcp(): Promise<void> {
  if (!config.mcp.configPath) return;
  try {
    const servers = parseMcpConfigFile(config.mcp.configPath);
    if (servers.length === 0) return;
    mcp = await connectMcpServers({ servers });
    for (const status of mcp.status) {
      if (status.connected) {
        console.log(`MCP server "${status.name}" connected (${status.toolCount} tool(s))`);
      } else {
        console.warn(`MCP server "${status.name}" failed: ${status.error ?? 'unknown error'}`);
      }
    }
  } catch (error) {
    console.error('MCP bootstrap failed:', error instanceof Error ? error.message : error);
  }
}

async function bootstrapSkills(): Promise<void> {
  if (!config.skills.skillsDir && !config.skills.catalogUrl) return;
  try {
    skillState = await loadSkills({
      skillsDir: config.skills.skillsDir,
      catalogUrl: config.skills.catalogUrl,
      catalogToken: config.skills.catalogToken,
      allow: config.skills.allow.length ? config.skills.allow : undefined,
      renderContext: config.skills.renderContext,
    });
    if (skillState.skills.length > 0) {
      console.log(
        `Loaded ${skillState.skills.length} skill(s): ${skillState.skills
          .map((s) => `${s.skillName} (${s.sourceId})`)
          .join(', ')}`,
      );
    }
  } catch (error) {
    console.error('Skill load failed:', error instanceof Error ? error.message : error);
  }
}

let toolCtx: ToolContext = {
  approvals,
  vectorDbBaseUrl: config.vectorDb.baseUrl,
  vectorDbApiKey: config.vectorDb.apiKey,
  allowedHttpHosts: [...config.tools.allowedHttpHosts],
};

function rebuildToolCtx(): void {
  const hosts = [...new Set([...config.tools.allowedHttpHosts, ...skillState.derivedHosts])];
  toolCtx = {
    approvals,
    vectorDbBaseUrl: config.vectorDb.baseUrl,
    vectorDbApiKey: config.vectorDb.apiKey,
    allowedHttpHosts: hosts,
  };
}

const app = express();
app.use(cors({ origin: config.allowedOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// ── Auth chain on /api ───────────────────────────────────────────────────
//
// 1. validatePlatformRequest synthesizes req.session from a valid
//    X-Platform-Token (the mothership's INTERNAL_SERVICE_KEY).
// 2. injectDevSession (only when AGENT_DEV_AUTH=true) gives unauthenticated
//    requests a fake admin session — for local dev. Refused at boot if
//    NODE_ENV=production (see config.ts).
// 3. requireAgentSession enforces presence; allows /api/health and
//    /api/webhook/* through unauthenticated since each has its own gate.
//
// Generated agents that also serve real end-user traffic from a public web UI
// can layer cookie auth (e.g. @teamsuzie/shared-auth) before requireAgentSession;
// it sets req.session.user too, so the gate is unchanged.
const platformBridgeConfig: PlatformBridgeConfig = {
  platformToken: config.platform?.token,
};
app.use('/api', createPlatformRequestMiddleware(platformBridgeConfig));
if (config.devAuth) {
  console.warn('[auth] AGENT_DEV_AUTH=true — every /api request gets a synthetic admin session. Do not use in production.');
  app.use('/api', injectDevSession());
}
app.use('/api', requireAgentSession());

app.use(
  '/api',
  createFilesRouter({ store: fileStore, maxUploadBytes: config.files.maxUploadBytes }),
);

app.use(
  '/api/chats',
  createChatsRouter({
    store: chats,
    getWorkspaceId: () => ASSISTANT_WORKSPACE_ID,
  }),
);

app.get('/api/personas', (_req, res) => {
  res.json({ personas: personaRegistry.listBuiltins() });
});

app.get('/api/health', async (_req, res) => {
  let reachable = false;
  let runtimeError = '';

  try {
    await fetch(`${config.agent.baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    reachable = true;
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : 'Health check failed';
  }

  if (!reachable) {
    try {
      const probe = await fetch(config.agent.baseUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      reachable = probe.status > 0;
      runtimeError = '';
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : runtimeError;
    }
  }

  res.json({
    status: 'ok',
    title: config.title,
    agent: {
      name: config.agent.name,
      description: config.agent.description,
      model: config.agent.model,
      reachable,
      ...(runtimeError ? { error: runtimeError } : {}),
    },
    platform: config.platform
      ? { slug: config.platform.slug, registered: Boolean(config.platform.url) }
      : { slug: null, registered: false },
    tools: activeTools().map((t) => ({ name: t.name, description: t.description })),
    skills: skillState.skills.map((s) => ({
      skillName: s.skillName,
      name: s.name,
      description: s.description,
      sourceId: s.sourceId,
    })),
    mcp: mcp.status,
    allowedHttpHosts: toolCtx.allowedHttpHosts ?? [],
  });
});

// Webhook endpoint for the mothership — install / uninstall / dm / ping.
// Each event type has its own X-Platform-Token guard inside the router.
// Mounted only when a token is configured; otherwise the agent has nothing
// to compare against and the endpoint should not exist.
if (config.platform?.token) {
  app.use(
    '/api/webhook/mothership',
    createWebhookRouter(platformBridgeConfig, {
      onInstall: async (ctx) => {
        console.log(
          `[${config.platform!.slug}] installed by org ${ctx.org_id}, agent_id=${ctx.agent_id}`,
        );
        // To call platform tools later (e.g. vector_search via the mothership),
        // persist ctx.platform_api_key per org here.
      },
      onUninstall: async (ctx) => {
        console.log(`[${config.platform!.slug}] uninstalled by org ${ctx.org_id}`);
      },
      onDirectMessage: async (ctx) => {
        try {
          const transcript = (ctx.context as { transcript?: Array<{ from: string; text: string }> } | undefined)
            ?.transcript;
          const response = await runWebhookChatTurn({
            agent: config.agent,
            tools: activeTools(),
            toolCtx,
            systemPrompt: config.agent.systemPrompt,
            fromAgentName: ctx.from_agent.name,
            message: ctx.message,
            transcript,
            maxIterations: config.tools.maxIterations,
          });
          return { response };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[${config.platform!.slug}] DM from ${ctx.from_agent.name} failed:`, msg);
          return { response: `[${config.platform!.name} could not respond: ${msg}]` };
        }
      },
    }),
  );
}

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const history = Array.isArray(req.body?.history) ? (req.body.history as ChatMessage[]) : [];
  const sessionId = String(req.body?.sessionId || '').trim();
  const chatId = String(req.body?.chatId || '').trim();
  const persistedChat = chatId ? chats.getChat(chatId) : null;
  if (chatId && (!persistedChat || persistedChat.workspaceId !== ASSISTANT_WORKSPACE_ID)) {
    res.status(404).json({ error: 'chat_not_found' });
    return;
  }
  const attachmentIds = Array.isArray(req.body?.attachmentIds)
    ? (req.body.attachmentIds as unknown[]).map(String).filter(Boolean)
    : [];
  const requestedModel = String(req.body?.model || '').trim();
  const personaId = String(req.body?.personaId || '').trim();
  const persona = personaId
    ? personaRegistry.listBuiltins().find((p) => p.id === personaId) ?? null
    : null;

  const baseAgent = config.agent;
  const effectiveModel = requestedModel || persona?.model || baseAgent.model;
  const agent = { ...baseAgent, model: effectiveModel };

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  const attachmentRecords =
    sessionId && attachmentIds.length > 0
      ? fileStore.getMany(sessionId, attachmentIds)
      : [];
  const attachmentContext = buildAttachmentContext(attachmentRecords);
  const userContent = attachmentContext
    ? `${attachmentContext}\n\n[Message]\n${message}`
    : message;

  const messages: ChatMessage[] = [...history, { role: 'user', content: userContent }];

  const docTools = buildDocumentTools({
    sessionId,
    fileStore,
    docStore,
    markitdownBaseUrl: config.markitdown.baseUrl,
  });
  const turnTools = [...activeTools(), ...docTools];

  const turnConfig = applyPersona({
    skillSystemPrompt: skillState.systemPrompt,
    tools: turnTools,
    persona,
  });

  let assistantText = '';
  const collectedToolEvents: unknown[] = [];

  try {
    for await (const event of runChatTurn({
      agent,
      messages,
      tools: turnConfig.tools,
      toolCtx,
      systemPrompt: turnConfig.systemPrompt,
      maxIterations: config.tools.maxIterations,
      signal: abort.signal,
    })) {
      send(event);
      if (persistedChat) {
        if (event.type === 'chunk') {
          assistantText += event.text;
        } else if (
          event.type === 'tool_call' ||
          event.type === 'tool_result' ||
          event.type === 'tool_error'
        ) {
          collectedToolEvents.push(event);
        }
      }
      if (event.type === 'done' || event.type === 'error') break;
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Chat request failed' });
  } finally {
    if (persistedChat) {
      try {
        chats.appendMessage({
          chatId: persistedChat.id,
          role: 'user',
          content: message,
        });
        chats.appendMessage({
          chatId: persistedChat.id,
          role: 'assistant',
          content: assistantText,
          toolEvents:
            collectedToolEvents.length > 0
              ? JSON.stringify(collectedToolEvents)
              : null,
          citations: null,
        });
        if (persistedChat.name === 'New chat') {
          const firstLine = message.split('\n')[0]?.trim() ?? '';
          const provisional =
            firstLine.length > 0
              ? firstLine.slice(0, 60) + (firstLine.length > 60 ? '…' : '')
              : 'New chat';
          if (provisional !== persistedChat.name) {
            chats.updateChat(persistedChat.id, { name: provisional });
          }
        }
      } catch (err) {
        console.error(
          'Failed to persist chat messages:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    res.end();
  }
});

app.get('/api/approvals', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  const items = await approvals.list({
    status: status === 'all' ? undefined : (status as 'pending' | 'approved' | 'rejected' | 'dispatched' | 'failed'),
  });
  res.json({ items });
});

app.post('/api/approvals/:id/review', async (req, res) => {
  const id = req.params.id;
  const verdict = req.body?.verdict === 'approve' ? 'approve' : 'reject';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

  try {
    const reviewed = await approvals.review(id, {
      reviewer_id: 'human',
      verdict,
      reason,
    });
    res.json({ ok: true, item: reviewed });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Review failed',
    });
  }
});

app.post('/api/session/reset', (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  if (sessionId) {
    fileStore.clearSession(sessionId);
    docStore.clearSession(sessionId);
  }
  res.json({ ok: true });
});

// Brand assets live in <build-root>/assets and are served at /assets/*.
// build-root is process.cwd() when the starter is run from inside a build.
const buildAssetsDir = path.resolve(process.cwd(), 'assets');
app.use(
  '/assets',
  express.static(buildAssetsDir, {
    fallthrough: false,
    immutable: true,
    maxAge: '1y',
  }),
);

app.use(express.static(clientDistDir));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(clientDistDir, 'index.html'), (error) => {
    if (error) {
      next();
    }
  });
});

async function main(): Promise<void> {
  await bootstrapSkills();
  rebuildToolCtx();
  await bootstrapMcp();

  // Marketplace registration: idempotent, safe to call on every boot.
  // capabilities.tools is derived from the live tool list so it stays
  // accurate as tools are added/removed.
  if (config.platform?.url) {
    registerWithPlatform(
      {
        platformUrl: config.platform.url,
        registrationToken: config.platform.registrationToken,
      },
      {
        slug: config.platform.slug,
        name: config.platform.name,
        description: config.platform.description,
        provider_name: config.platform.providerName,
        base_url: config.publicUrl,
        health_endpoint: '/api/health',
        chat_endpoint: '/api/chat',
        webhook_endpoint: '/api/webhook/mothership',
        capabilities: {
          tools: activeTools().map((t) => t.name),
          features: config.platform.features,
        },
        version: config.platform.version,
      },
    ).catch((err) =>
      console.warn(
        `[${config.platform!.slug}] Platform registration failed:`,
        err instanceof Error ? err.message : err,
      ),
    );
  }

  const server = app.listen(config.port, () => {
    console.log(`${config.title} listening on ${config.publicUrl}`);
    if (toolCtx.allowedHttpHosts && toolCtx.allowedHttpHosts.length > 0) {
      console.log(`http_request allow-list: ${toolCtx.allowedHttpHosts.join(', ')}`);
    }
    if (config.platform) {
      const mode = config.platform.url ? 'will register with mothership' : 'token-only (no registration URL)';
      console.log(`Platform bridge: ${mode} as "${config.platform.slug}"`);
    } else {
      console.log('Platform bridge: not configured (set PLATFORM_URL + PLATFORM_TOKEN to enable marketplace integration)');
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    await mcp.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
