import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApprovalQueue } from '@teamsuzie/approvals';
import { FileRouteStore, SEED_ROUTES } from '@teamsuzie/email-webmail';
import { JobQueue, SqliteJobStorage } from '@teamsuzie/jobs';
import { openAiCompatibleRouteModel } from '@teamsuzie/webmail-learn';
import express, { type Request, type Response } from 'express';
import { adminRouter } from './admin.js';
import { AlertStore, MacNotifier, type Notifier } from './alerts.js';
import { SqliteApprovalStore } from './approval-store.js';
import { bearerToken, sameToken } from './auth.js';
import type { AgentConfig } from './config.js';
import { consoleRouter } from './console.js';
import { openAgentDb } from './db.js';
import { AccountHandler, type HandlerRuntime } from './handler.js';
import { HealthStore } from './health.js';
import { JobService, SEND_APPROVAL_ACTION, type JobPayload } from './jobs.js';
import { LayoutBaselineStore } from './layout.js';
import { createMcpServer, type McpDeps } from './mcp.js';
import { NewMailStore } from './new-mail.js';
import { ChromeRuntime } from './runtime.js';

export interface RunningService {
    url: string;
    close(): Promise<void>;
}

export interface ServiceOptions {
    log: (message: string) => void;
    /** Replaces the Chrome runtime (tests). */
    runtimeFor?: (account: AgentConfig['accounts'][number]) => HandlerRuntime;
    /** Replaces the configured notifiers (tests). */
    notifiers?: Notifier[];
}

/** Open the stores, start one handler per account, and serve MCP (agents), the admin API (CLI) and the console. */
export async function startService(config: AgentConfig, options: ServiceOptions): Promise<RunningService> {
    const { log } = options;
    const now = () => new Date();
    mkdirSync(config.data_dir, { recursive: true, mode: 0o700 });
    const db = openAgentDb(join(config.data_dir, 'email-agent.db'));
    const queue = new JobQueue({ storage: SqliteJobStorage.open({ db }) });
    const approvalStore = new SqliteApprovalStore(db, now);
    const approvals = new ApprovalQueue({ store: approvalStore });
    const notifiers = options.notifiers ?? (config.notifications === 'macos' ? [new MacNotifier()] : []);
    const alerts = new AlertStore(db, notifiers, now);
    const newMail = new NewMailStore(db, now);
    const health = new HealthStore(db, now);
    const layout = new LayoutBaselineStore(db, now);
    const jobs = new JobService({
        queue, approvals, approvalStore, config, newMail, now,
        approvalNeeded: async (payload, approvalId, reason) => {
            await alerts.raise(payload.account, 'approval_needed', `${payload.agent_id} wants to ${payload.kind} ${String(payload.params.to ?? '')}: ${reason}. Run \`email-agent approvals\`, then approve or reject ${approvalId}.`);
        },
    });
    approvals.registerDispatcher<JobPayload>({
        action_type: SEND_APPROVAL_ACTION,
        dispatch: async (item) => {
            jobs.enqueueApproved(item);
            return { success: true };
        },
    });

    const routes = new FileRouteStore(join(config.data_dir, 'routes'));
    for (const provider of new Set(config.accounts.map((a) => a.provider))) {
        routes.seed(SEED_ROUTES[provider]);
        // A route learned before an operation existed gets that operation from the seed (and is then relearned
        // like any other when it does not match the page).
        const added = routes.addMissingOperations(SEED_ROUTES[provider], now());
        if (added.length > 0) log(`[routes] added ${added.join(', ')} to the ${provider} route from its starting route`);
    }
    const apiKey = config.learner.api_key_env === null ? undefined : process.env[config.learner.api_key_env];
    const model = openAiCompatibleRouteModel({ baseUrl: config.learner.base_url, model: config.learner.model, apiKey, maxTokens: config.learner.max_tokens });

    const handlers = new Map<string, AccountHandler>();
    for (const account of config.accounts) {
        const runtime = options.runtimeFor
            ? options.runtimeFor(account)
            : new ChromeRuntime({ account, config, routes, model, log, now });
        const handler = new AccountHandler({
            account: { address: account.address, provider: account.provider },
            config, queue, jobs, runtime, health, alerts, newMail, layout, now,
            random: Math.random,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            log,
            idleMs: 1000,
        });
        handlers.set(account.address.toLowerCase(), handler);
    }

    const mcpDeps: McpDeps = { config, jobs, handlers, newMail, alerts, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
    const app = express();
    app.use(express.json({ limit: '2mb' }));

    app.all('/mcp', async (req: Request, res: Response) => {
        const token = bearerToken(req.headers.authorization);
        const agent = token === null ? undefined : config.agents.find((a) => sameToken(a.token, token));
        if (!agent) {
            res.status(401).json({ error: 'The agent token is missing or unknown' });
            return;
        }
        // Stateless: a fresh server and transport per request.
        const server = createMcpServer(mcpDeps, agent.id);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    app.use('/admin', adminRouter({ adminToken: config.admin_token, handlers, approvals, alerts, log }));
    app.use('/console', consoleRouter({ config, mcpDeps }));

    const server = await new Promise<Server>((resolve, reject) => {
        const s = app.listen(config.listen.port, config.listen.host, () => resolve(s));
        s.on('error', reject);
    });
    for (const handler of handlers.values()) handler.start();
    const url = `http://${config.listen.host}:${config.listen.port}`;
    log(`email-agent listening on ${url} (MCP at /mcp, console at /console) for ${config.accounts.map((a) => a.address).join(', ')}`);

    return {
        url,
        close: async () => {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
            for (const handler of handlers.values()) await handler.stop();
            db.close();
        },
    };
}
