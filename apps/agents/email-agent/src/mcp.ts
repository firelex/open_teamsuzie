import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AlertStore } from './alerts.js';
import type { AgentConfig } from './config.js';
import type { AccountHandler } from './handler.js';
import { AGENT_JOB_KINDS, JobFailure, type JobService, type JobView } from './jobs.js';
import type { NewMailStore } from './new-mail.js';

export interface McpDeps {
    config: AgentConfig;
    jobs: JobService;
    handlers: Map<string, Pick<AccountHandler, 'state'>>;
    newMail: NewMailStore;
    alerts: AlertStore;
    sleep: (ms: number) => Promise<void>;
}

const MAX_WAIT_SECONDS = 120;
const WAIT_POLL_MS = 500;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

function ok(value: unknown): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failed(error: JobFailure): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: error.code, message: error.message } }) }] };
}

/** Run a tool body; a JobFailure becomes a tool error the agent can read, anything else is thrown. */
async function tool(fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
        return ok(await fn());
    } catch (error) {
        if (error instanceof JobFailure) return failed(error);
        throw error;
    }
}

const SUBMIT_DESCRIPTION = `Ask for something to be done in one of the user's mailboxes. Each mailbox is worked by a browser that does one job at a time, at a human pace, so jobs take seconds to minutes. This returns a job id at once; use wait_job or get_job for the result.

Job kinds and their params:
- list_inbox: {"limit": 1-100} — the newest conversations in the inbox (id, thread id, sender, subject, date, preview, unread).
- read_message: {"message_id": "<id from list_inbox or search>"} — the full message, including body text. Opening it marks it read in the mailbox.
- read_thread: {"thread_id": "<thread id>"} — every message in the conversation.
- search: {"query": "<words, using the mailbox's own search syntax>", "limit": 1-100} — matching conversations.
- send: {"to": "a@x.com, b@y.com", "cc": "...", "bcc": "...", "subject": "...", "body": "<plain text>"} — a new message.
- reply: {"message_id": "<id>", "body": "<plain text>", "to": "<optional; defaults to the original sender>", "cc": "..."} — a reply in the same conversation.

Sends and replies go out at once only when the user's send rules allow it; otherwise the job waits as "awaiting_approval" until the user approves or rejects it. Plain text only; no attachments.`;

/** The MCP tools one agent sees. Every tool acts as `agentId`; agents see only their own jobs. */
export function createMcpServer(deps: McpDeps, agentId: string): McpServer {
    const server = new McpServer({ name: 'teamsuzie-email-agent', version: '0.1.0' });

    const ownView = async (jobId: string): Promise<JobView> => {
        const view = await deps.jobs.view(jobId);
        if (!view || view.agent_id !== agentId) throw new JobFailure('invalid_request', `No job ${jobId} for ${agentId}`);
        return view;
    };

    server.registerTool('submit_job', {
        description: SUBMIT_DESCRIPTION,
        inputSchema: {
            account: z.string().describe('The mailbox address, as list_accounts shows it.'),
            kind: z.enum(AGENT_JOB_KINDS),
            params: z.record(z.unknown()).describe('The parameters for this kind of job, as listed above.'),
            timeout_seconds: z.number().positive().optional().describe('Give up if the job has not run within this many seconds of entering the queue. The service default applies when omitted.'),
            urgent: z.boolean().optional().describe('Run before other jobs, and also during the user\'s quiet hours. Use only when it cannot wait.'),
        },
    }, (args) => tool(() => deps.jobs.submit(agentId, args)));

    server.registerTool('get_job', {
        description: 'The current state of one of your jobs: awaiting_approval, queued, running, done (with its result) or failed (with an error code and message). Error codes: route_broken (that mailbox action is broken and could not be relearned; the user has been told), unreadable_value (the mailbox showed a value, such as a date, that the service cannot read; the user has been told), needs_login (the user must sign in again), account_mismatch, approval_rejected, job_timeout, invalid_request, send_unconfirmed, internal_error.',
        inputSchema: { job_id: z.string() },
    }, ({ job_id }) => tool(() => ownView(job_id)));

    server.registerTool('wait_job', {
        description: `Wait until one of your jobs is done, failed or cancelled, for at most timeout_seconds (up to ${MAX_WAIT_SECONDS}), then return its state as get_job does. If it is still running when the time is up, call wait_job again.`,
        inputSchema: { job_id: z.string(), timeout_seconds: z.number().positive().max(MAX_WAIT_SECONDS) },
    }, ({ job_id, timeout_seconds }) => tool(async () => {
        const deadline = Date.now() + timeout_seconds * 1000;
        let view = await ownView(job_id);
        while (!TERMINAL.has(view.status) && Date.now() < deadline) {
            await deps.sleep(WAIT_POLL_MS);
            view = await ownView(job_id);
        }
        return view;
    }));

    server.registerTool('list_jobs', {
        description: 'Your jobs, newest first, including sends waiting for approval.',
        inputSchema: { limit: z.number().int().min(1).max(200) },
    }, ({ limit }) => tool(() => deps.jobs.listForAgent(agentId, { limit })));

    server.registerTool('cancel_job', {
        description: 'Cancel one of your jobs that has not started yet (queued, or waiting for approval). A running job cannot be cancelled.',
        inputSchema: { job_id: z.string() },
    }, ({ job_id }) => tool(() => deps.jobs.cancel(agentId, job_id)));

    server.registerTool('list_accounts', {
        description: 'The mailboxes you can submit jobs for, with whether each is ready.',
        inputSchema: {},
    }, () => tool(async () => deps.config.accounts.map((account) => {
        const handler = deps.handlers.get(account.address.toLowerCase());
        if (!handler) throw new Error(`No handler for ${account.address}`);
        return { account: account.address, provider: account.provider, status: handler.state().status };
    })));

    server.registerTool('account_status', {
        description: 'Detailed state of one mailbox: whether it is ready, and each mail action\'s health (healthy, suspect, relearning or broken) with its last error.',
        inputSchema: { account: z.string() },
    }, ({ account }) => tool(async () => {
        const handler = deps.handlers.get(account.toLowerCase());
        if (!handler) throw new JobFailure('invalid_request', `Unknown account ${account}`);
        return handler.state();
    }));

    server.registerTool('list_alerts', {
        description: 'Problems and changes the user has been told about (broken or relearned mail actions, sign-ins needed, sends waiting for approval), oldest first, after the given sequence number. Pass the last seq you saw to get only newer ones; 0 for all.',
        inputSchema: { after: z.number().int().min(0), limit: z.number().int().min(1).max(200), account: z.string().optional() },
    }, ({ after, limit, account }) => tool(async () => deps.alerts.list({ after, limit, account })));

    server.registerTool('list_new_mail', {
        description: 'Messages that have arrived in the inboxes, in the order the service first saw them (it checks every few minutes). Pass the cursor from your last call to get only newer ones; 0 for all. This reads the service\'s own record and does not open anything in the mailbox; use read_message for a body.',
        inputSchema: { after: z.number().int().min(0), limit: z.number().int().min(1).max(200), account: z.string().optional() },
    }, ({ after, limit, account }) => tool(async () => deps.newMail.list({ after, limit, account })));

    return server;
}
