import cors from 'cors';
import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import {
  Agent,
  AgentApiKey,
  AgentProfile,
  AgentWorkspaceFile,
  AuditLog,
  ConfigDefinition,
  ConfigValue,
  OrgDomain,
  Organization,
  OrganizationMember,
  SequelizeService,
  SessionService,
  User,
  UserAccessToken,
  createAuthRouter,
  createRequestId,
  type SharedAuthConfig,
} from '@teamsuzie/shared-auth';
import type { ModelCtor } from 'sequelize-typescript';
import { ChatController } from './controllers/chat.js';
import { AgentsController } from './controllers/agents.js';
import { SkillsController } from './controllers/skills.js';
import { ApprovalsController } from './controllers/approvals.js';
import { WorkspaceController } from './controllers/workspace.js';
import { AgentKeysController } from './controllers/agent-keys.js';
import { ConfigController } from './controllers/config.js';
import { ActivityController } from './controllers/activity.js';
import { createChatRouter } from './routes/chat.js';
import { createAgentsRouter, createAgentProfilesRouter } from './routes/agents.js';
import { createSkillsRouter } from './routes/skills.js';
import { createApprovalsRouter } from './routes/approvals.js';
import { createWorkspaceRouter } from './routes/workspace.js';
import { createAgentKeysRouter } from './routes/agent-keys.js';
import { createConfigRouter } from './routes/config.js';
import { createActivityRouter } from './routes/activity.js';
import { ChatProxyService } from './services/chat-proxy.js';
import { AgentsService } from './services/agents.js';
import { SkillsService } from './services/skills.js';
import { WorkspaceService } from './services/workspace.js';
import { AgentKeysService } from './services/agent-keys.js';
import { ConfigService, DEFAULT_DEFINITIONS } from './services/config.js';
import { ActivityService } from './services/activity.js';
import { createApprovalQueue } from './services/approvals.js';
import { ensureSeed } from './services/seed.js';
import { printStartupError } from './services/startup-errors.js';
import { getSession } from './middleware/auth.js';
import { config as defaultConfig, sharedAuthConfig as defaultSharedAuthConfig } from './config.js';

export interface CreateAppOptions {
  /** Admin runtime config (port, title, demo creds, chat agents, etc.). Defaults to env-derived config. */
  config?: typeof defaultConfig;
  /** Shared-auth config (postgres, redis, cookies, CSRF). Defaults to env-derived. */
  sharedAuthConfig?: SharedAuthConfig;
  /** Override the skills directory. Defaults to packages/skills/templates resolved from this file. */
  skillsDir?: string;
  /** Run the dev-time ensureSeed() step. Defaults to config.nodeEnv === 'development'. */
  runSeed?: boolean;
  /** Run the config definition seed. Defaults to true. */
  runConfigSeed?: boolean;
}

export interface AdminApp {
  app: Express;
  server: Server;
  /** Shuts down ws + releases Sequelize/Redis connections. */
  close: () => Promise<void>;
}

/**
 * Build the admin Express app + HTTP server without starting it. Tests call
 * this directly to exercise the routes against a test database; the
 * production runner in `index.ts` calls it and then `server.listen()`s.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<AdminApp> {
  const config = options.config ?? defaultConfig;
  const sharedAuthConfig = options.sharedAuthConfig ?? defaultSharedAuthConfig;
  const runSeed = options.runSeed ?? config.nodeEnv === 'development';
  const runConfigSeed = options.runConfigSeed ?? true;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDistDir = path.resolve(__dirname, '../client/dist');
  const skillsDir = options.skillsDir ?? SkillsService.defaultSkillsDir();

  const app = express();
  app.use(createRequestId());
  app.use(cors({ origin: config.allowedOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  type ModelWithAssociate = ModelCtor & { associate: (models: unknown) => void };
  const sequelizeService = new SequelizeService(
    sharedAuthConfig,
    [
      User,
      Organization,
      OrganizationMember,
      AgentProfile,
      Agent,
      OrgDomain,
      UserAccessToken,
      AuditLog,
      AgentWorkspaceFile,
      AgentApiKey,
      ConfigDefinition,
      ConfigValue,
    ] as ModelWithAssociate[],
  );

  try {
    await sequelizeService.getSequelize().authenticate();
    await sequelizeService.getSequelize().sync();
  } catch (err) {
    printStartupError(err);
    throw err;
  }

  if (runSeed) {
    try {
      const summary = await ensureSeed();
      if (summary.created && config.nodeEnv === 'development') {
        console.log('[seed] created demo data');
        console.log(`  admin login: ${summary.adminEmail} / ${summary.adminPassword}`);
        console.log(`  demo login:  ${summary.demoEmail} / ${summary.demoPassword}`);
      }
    } catch (err) {
      console.warn('[seed] skipped — will retry on next boot');
      console.warn(`  reason: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sessionService = new SessionService(sharedAuthConfig);
  sessionService.init(app);

  const configService = new ConfigService(config.configSecret);
  if (runConfigSeed) {
    try {
      await configService.ensureDefinitions(DEFAULT_DEFINITIONS);
    } catch (err) {
      console.warn(`[config] definition seed skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const chatProxyService = new ChatProxyService(configService);
  const chatController = new ChatController(chatProxyService);

  app.get('/api/health', (_req, res) => {
    const demo =
      config.nodeEnv === 'development'
        ? { email: config.demo.email, password: config.demo.password }
        : undefined;
    res.json({
      status: 'ok',
      service: 'admin',
      title: config.title,
      agentsConfigured: config.agents.length,
      demo,
    });
  });

  app.use('/api/auth', createAuthRouter(sharedAuthConfig));

  app.get('/api/session', (req, res) => {
    const session = getSession(req);
    if (!session.userId) {
      res.json({ user: null });
      return;
    }
    res.json({
      user: {
        id: session.userId,
        email: session.userEmail,
        name: session.userName,
        role: session.userRole,
      },
    });
  });

  const agentsService = new AgentsService();
  const agentsController = new AgentsController(agentsService);
  app.use('/api/agents', createAgentsRouter(agentsController));
  app.use('/api/agent-profiles', createAgentProfilesRouter(agentsController));

  const skillsService = new SkillsService(skillsDir);
  const skillsController = new SkillsController(skillsService);
  app.use('/api/skill-templates', createSkillsRouter(skillsController));

  const approvalQueue = createApprovalQueue();
  const approvalsController = new ApprovalsController(approvalQueue);
  app.use('/api/approvals', createApprovalsRouter(approvalsController));

  const workspaceService = new WorkspaceService();
  const workspaceController = new WorkspaceController(workspaceService);
  app.use('/api/workspace', createWorkspaceRouter(workspaceController));

  const agentKeysService = new AgentKeysService();
  const agentKeysController = new AgentKeysController(agentKeysService);
  app.use('/api/agent-keys', createAgentKeysRouter(agentKeysController));

  const configController = new ConfigController(configService);
  app.use('/api/config', createConfigRouter(configController));

  // Activity — Phase 7. Read-only view on audit_log + Agent.last_active_at.
  const activityService = new ActivityService();
  const activityController = new ActivityController(activityService);
  app.use('/api/activity', createActivityRouter(activityController));

  app.use('/api/chat', createChatRouter(chatController));

  app.use(express.static(clientDistDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistDir, 'index.html'), (error) => {
      if (error) next();
    });
  });

  const server = createServer(app);
  chatController.initWebSocket(server);

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    try {
      await sequelizeService.getSequelize().close();
    } catch {
      // Ignore — already closed or never opened.
    }
  }

  return { app, server, close };
}
