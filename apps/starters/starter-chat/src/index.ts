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
import { config } from './config.js';
import {
  buildAttachmentContext,
  createFilesRouter,
  InMemoryFileStore,
} from './files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, '../client/dist');

const approvals = new ApprovalQueue({ store: new InMemoryApprovalStore() });
const fileStore = new InMemoryFileStore();

let skillState: SkillLoadResult = { skills: [], systemPrompt: '', derivedHosts: [] };
let mcp: McpManager = { tools: [], status: [], shutdown: async () => {} };

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
  const attachmentIds = Array.isArray(req.body?.attachmentIds)
    ? (req.body.attachmentIds as unknown[]).map(String).filter(Boolean)
    : [];

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
  req.on('close', () => abort.abort());

  const attachmentRecords =
    sessionId && attachmentIds.length > 0
      ? fileStore.getMany(sessionId, attachmentIds)
      : [];
  const attachmentContext = buildAttachmentContext(attachmentRecords);
  const userContent = attachmentContext
    ? `${attachmentContext}\n\n[Message]\n${message}`
    : message;

  const messages: ChatMessage[] = [...history, { role: 'user', content: userContent }];

  try {
    for await (const event of runChatTurn({
      agent: config.agent,
      messages,
      tools: activeTools(),
      toolCtx,
      systemPrompt: skillState.systemPrompt || undefined,
      maxIterations: config.tools.maxIterations,
      signal: abort.signal,
    })) {
      send(event);
      if (event.type === 'done' || event.type === 'error') break;
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Chat request failed' });
  } finally {
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
  if (sessionId) fileStore.clearSession(sessionId);
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
