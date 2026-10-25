import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CanaryResult } from '@teamsuzie/email-webmail';
import { OPERATION_NAMES } from '@teamsuzie/webmail-routes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Alert } from './alerts.js';
import type { AgentConfig } from './config.js';
import type { HandlerClient, HandlerRuntime } from './handler.js';
import { startService, type RunningService } from './service.js';
import { exampleConfig } from './test-support.js';

/** A runtime that answers from memory, so the whole service runs without Chrome. */
class MemoryRuntime implements HandlerRuntime {
    sent: string[] = [];
    async open() {}
    async close() {}
    async canary(only?: string[]) { return (only ?? [...OPERATION_NAMES]).map((operation) => ({ operation, outcome: 'passed' }) as CanaryResult); }
    async relearn(): Promise<never> { throw new Error('not expected'); }
    async fingerprint() { return 'fp'; }
    async login() { return 'completed' as const; }
    async capture() { return ['/tmp/capture.json']; }
    client(): HandlerClient {
        return {
            listMessages: async () => ({ messages: [{ id: 'm1', threadId: 't1', from: 'bob@other.org', subject: 'Lunch', to: null, date: '2026-10-26T09:00:00.000Z', bodyPreview: 'Free?', unread: true }] }),
            getMessage: async (id) => ({ id, subject: 'Lunch', from: 'bob@other.org', to: 'me@firm.com', date: '2026-10-26T09:00:00.000Z', bodyText: 'Free on Tuesday?' }),
            getThread: async () => { throw new Error('not expected'); },
            send: async (input) => { this.sent.push(input.to); return { queueId: 'q', queued: true }; },
            reply: async (input) => { this.sent.push(input.to!); return { queueId: 'q', queued: true }; },
            readAccount: async () => 'me@firm.com',
            confirmSent: async () => true,
            cleanTestDrafts: async () => 0,
        };
    }
}

let dir: string;
let config: AgentConfig;
let service: RunningService;
let runtime: MemoryRuntime;
const alerts: Alert[] = [];

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'email-agent-'));
    config = { ...exampleConfig(), data_dir: dir, listen: { host: '127.0.0.1', port: 40_000 + Math.floor(Math.random() * 20_000) }, accounts: [exampleConfig().accounts[0]!], volume: { ...exampleConfig().volume, quiet_hours: null } };
    runtime = new MemoryRuntime();
    alerts.length = 0;
    service = await startService(config, { log: () => undefined, runtimeFor: () => runtime, notifiers: [{ notify: async (a) => { alerts.push(a); } }] });
});

afterEach(async () => {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
});

async function mcpClient(token: string): Promise<Client> {
    const client = new Client({ name: 'test-agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${service.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; value: any }> {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text: string }>).map((c) => c.text).join('');
    return { isError: result.isError === true, value: JSON.parse(text) };
}

const admin = async (method: string, path: string, body?: unknown, token = config.admin_token) => {
    const res = await fetch(`${service.url}/admin${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
};

describe('the service over HTTP', () => {
    it('lets an agent list accounts, submit a job and wait for its result over MCP', async () => {
        const agent = await mcpClient(config.agents[0]!.token);
        const tools = (await agent.listTools()).tools.map((t) => t.name).sort();
        expect(tools).toEqual(['account_status', 'cancel_job', 'get_job', 'list_accounts', 'list_alerts', 'list_jobs', 'list_new_mail', 'submit_job', 'wait_job']);
        expect((await call(agent, 'list_accounts', {})).value).toEqual([{ account: 'me@firm.com', provider: 'outlook', status: expect.any(String) }]);
        const submitted = (await call(agent, 'submit_job', { account: 'me@firm.com', kind: 'read_message', params: { message_id: 'm1' } })).value;
        const done = (await call(agent, 'wait_job', { job_id: submitted.job_id, timeout_seconds: 15 })).value;
        expect(done).toMatchObject({ status: 'done', result: { message: { id: 'm1', bodyText: 'Free on Tuesday?' } } });
        await agent.close();
    });

    it('returns readable tool errors and keeps agents to their own jobs', async () => {
        const ops = await mcpClient(config.agents[0]!.token);
        const research = await mcpClient(config.agents[1]!.token);
        expect(await call(ops, 'submit_job', { account: 'nobody@x.com', kind: 'list_inbox', params: { limit: 5 } })).toMatchObject({ isError: true, value: { error: { code: 'invalid_request' } } });
        const { job_id } = (await call(ops, 'submit_job', { account: 'me@firm.com', kind: 'list_inbox', params: { limit: 5 } })).value;
        expect(await call(research, 'get_job', { job_id })).toMatchObject({ isError: true, value: { error: { code: 'invalid_request' } } });
        await ops.close();
        await research.close();
    });

    it('refuses MCP without a known agent token', async () => {
        const res = await fetch(`${service.url}/mcp`, { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: '{}' });
        expect(res.status).toBe(401);
    });

    it('holds a send for approval, tells the user, and sends it once approved through the admin API', async () => {
        const agent = await mcpClient(config.agents[1]!.token);
        const held = (await call(agent, 'submit_job', { account: 'me@firm.com', kind: 'send', params: { to: 'x@gmail.com', subject: 'Hi', body: 'Hello' } })).value;
        expect(held.status).toBe('awaiting_approval');
        expect(alerts.map((a) => a.kind)).toContain('approval_needed');
        expect((await admin('GET', '/approvals', undefined, 'wrong')).status).toBe(401);
        const pending = (await admin('GET', '/approvals')).body;
        expect(pending).toHaveLength(1);
        expect((await admin('POST', `/approvals/${pending[0].id}/approve`)).status).toBe(200);
        const done = (await call(agent, 'wait_job', { job_id: held.job_id, timeout_seconds: 15 })).value;
        expect(done.status).toBe('done');
        expect(runtime.sent).toEqual(['x@gmail.com']);
        expect((await admin('POST', `/approvals/${pending[0].id}/approve`)).status).toBe(409);
        await agent.close();
    });

    it('rejects a send through the admin API without sending', async () => {
        const agent = await mcpClient(config.agents[1]!.token);
        const held = (await call(agent, 'submit_job', { account: 'me@firm.com', kind: 'send', params: { to: 'x@gmail.com', subject: 'Hi', body: 'Hello' } })).value;
        const [item] = (await admin('GET', '/approvals')).body;
        await admin('POST', `/approvals/${item.id}/reject`, { reason: 'Not this one' });
        expect((await call(agent, 'get_job', { job_id: held.job_id })).value).toMatchObject({ status: 'failed', error: { code: 'approval_rejected', message: 'Not this one' } });
        expect(runtime.sent).toEqual([]);
        await agent.close();
    });

    it('reports status and runs the canary through the admin API', async () => {
        const status = (await admin('GET', '/status')).body;
        expect(status[0]).toMatchObject({ account: 'me@firm.com', provider: 'outlook' });
        expect(Object.keys(status[0].operations)).toEqual([...OPERATION_NAMES]);
        expect((await admin('POST', '/canary/me@firm.com')).body).toHaveLength(OPERATION_NAMES.length);
        expect((await admin('POST', '/canary/me@firm.com?check_only=true')).body).toHaveLength(OPERATION_NAMES.length);
        expect((await admin('POST', '/relearn/me@firm.com/delete_everything')).status).toBe(400);
        const relearn = await admin('POST', '/relearn/me@firm.com/search');
        expect(relearn).toMatchObject({ status: 202, body: { started: true, operation: 'search' } });
        expect((await admin('POST', '/canary/someone@else.com')).status).toBe(404);
        expect((await admin('POST', '/capture/me@firm.com')).body).toEqual({ files: ['/tmp/capture.json'] });
        expect((await admin('POST', '/routes/outlook/reset')).body).toMatchObject({ provider: 'outlook', route_version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/) });
        expect((await admin('POST', '/routes/yahoo/reset')).status).toBe(400);
    });

    it('serves the console page, whose tool calls act as the console agent and need the admin token', async () => {
        const page = await fetch(`${service.url}/console`);
        expect(await page.text()).toContain('Email Agent Console');
        const callTool = (token: string, body: unknown) => fetch(`${service.url}/console/api/tool`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        expect((await callTool('wrong', { tool: 'list_accounts', args: {} })).status).toBe(401);
        const submitted = await (await callTool(config.admin_token, { tool: 'submit_job', args: { account: 'me@firm.com', kind: 'send', params: { to: 'a@firm.com', subject: 'Hi', body: 'b' } } })).json() as any;
        expect(submitted.status).toBe('awaiting_approval');
        const view = await (await callTool(config.admin_token, { tool: 'get_job', args: { job_id: submitted.job_id } })).json() as any;
        expect(view.agent_id).toBe('console');
        const bad = await callTool(config.admin_token, { tool: 'submit_job', args: { account: 'x@y.com', kind: 'list_inbox', params: { limit: 1 } } });
        expect(bad.status).toBe(422);
    });
});
