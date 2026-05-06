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
import { config } from './config.js';
import {
  buildAttachmentContext,
  createFilesRouter,
  InMemoryFileStore,
} from './files.js';
import { buildDocumentTools } from './document-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, '../client/dist');

const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
const fileStore = new InMemoryFileStore();
const docStore = new InMemoryDocumentStore();

// SQLite-backed persistence for top-level Assistant chats. Single-user
// starter — every chat gets the synthetic workspace id `assistant:default`.
// Apps that bootstrap from this starter and add real auth would scope by
// user (e.g. `assistant:<userId>`), keeping per-user history separate.
const db = openDb({
  path: config.db.path,
  migrations: [...CHATS_MIGRATIONS],
});
const chats = new ChatsStore({ db });
const ASSISTANT_WORKSPACE_ID = 'assistant:default';

let skillState: SkillLoadResult = { skills: [], systemPrompt: '', derivedHosts: [] };
let mcp: McpManager = { tools: [], status: [], shutdown: async () => {} };

// File-based persona registry. starter-chat ships without auth/db so
// user-created personas aren't wired here — apps that bootstrap from this
// starter can layer in @teamsuzie/db-sqlite + auth + createPersonasRouter
// to enable CRUD. See README for the extension pattern.
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
app.use(
  '/api',
  createFilesRouter({ store: fileStore, maxUploadBytes: config.files.maxUploadBytes }),
);

// Persisted top-level Assistant chats. The router exposes list / create /
// get / messages / rename / delete under `/api/chats`; the chat-completion
// handler below picks up `chatId` from the request body and persists each
// turn into the same store. Single-user starter — workspace id is fixed.
app.use(
  '/api/chats',
  createChatsRouter({
    store: chats,
    getWorkspaceId: () => ASSISTANT_WORKSPACE_ID,
  }),
);

// File-based personas only. Apps that add auth + a SQLite db can swap this
// for `createPersonasRouter` from @teamsuzie/personas to enable user-created
// personas with full CRUD scoped to the caller.
app.get('/api/personas', (_req, res) => {
  res.json({ personas: personaRegistry.listBuiltins() });
});

app.get('/api/health', async (_req, res) => {
  try {
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
      },
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
  } catch (error) {
    res.json({
      status: 'ok',
      title: config.title,
      agent: {
        name: config.agent.name,
        description: config.agent.description,
        model: config.agent.model,
        reachable: false,
        error: error instanceof Error ? error.message : 'Health check failed',
      },
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
  }
});

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const history = Array.isArray(req.body?.history) ? (req.body.history as ChatMessage[]) : [];
  const sessionId = String(req.body?.sessionId || '').trim();
  // When set, the turn is bound to a persisted top-level Assistant chat:
  // both the user message and the assistant response are appended to its
  // message store on completion, so reload + History both see the chat.
  const chatId = String(req.body?.chatId || '').trim();
  const persistedChat = chatId ? chats.getChat(chatId) : null;
  if (chatId && (!persistedChat || persistedChat.workspaceId !== ASSISTANT_WORKSPACE_ID)) {
    res.status(404).json({ error: 'chat_not_found' });
    return;
  }
  const attachmentIds = Array.isArray(req.body?.attachmentIds)
    ? (req.body.attachmentIds as unknown[]).map(String).filter(Boolean)
    : [];
  // Per-request model override — set by the Settings page's model picker.
  // Falls back to the server's configured default.
  const requestedModel = String(req.body?.model || '').trim();
  // Per-request persona — looked up from the file-based registry.
  // (Apps that wire user-created personas via SQLite would resolve those here too.)
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
  // res.close (not req.close): fires when the response stream ends — i.e.,
  // the client actually disconnected. req.close in Express 5 / Node 22+ can
  // fire as soon as the request body is fully consumed by middleware, which
  // would abort the upstream LLM call before it ever runs.
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

  // Per-turn tools include the session-scoped document tools (lazy convert,
  // navigate, draft, export). When markitdown-agent isn't configured, only the
  // navigation/drafting subset shows up.
  const docTools = buildDocumentTools({
    sessionId,
    fileStore,
    docStore,
    markitdownBaseUrl: config.markitdown.baseUrl,
  });
  const turnTools = [...activeTools(), ...docTools];

  // Persona's system prompt replaces the default; skills always append; tools
  // are filtered by the persona's allow/blocklist.
  const turnConfig = applyPersona({
    skillSystemPrompt: skillState.systemPrompt,
    tools: turnTools,
    persona,
  });

  // Accumulate the assistant text + tool events while streaming so we can
  // persist a single message row on completion. Empty when no chat is bound.
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
        // User turn: store the original message, not the embellished
        // userContent — we don't want the [Attachments] block in history.
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
        // First-turn auto-title: trim the user's first message into a short
        // sidebar label. Apps that want LLM-polished titles can run a
        // background pass after the response stream ends.
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
        // Persistence failure shouldn't break the response stream.
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

  const server = app.listen(config.port, () => {
    console.log(`Starter chat listening on ${config.publicUrl}`);
    if (toolCtx.allowedHttpHosts && toolCtx.allowedHttpHosts.length > 0) {
      console.log(`http_request allow-list: ${toolCtx.allowedHttpHosts.join(', ')}`);
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
