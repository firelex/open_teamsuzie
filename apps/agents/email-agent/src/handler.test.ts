import { ApprovalQueue } from '@teamsuzie/approvals';
import type { EmailMessage } from '@teamsuzie/email';
import type { CanaryResult } from '@teamsuzie/email-webmail';
import { JobQueue, SqliteJobStorage } from '@teamsuzie/jobs';
import { NavigationError, NeedsLoginError, RouteError } from '@teamsuzie/webmail-browser';
import type { LearnOutcome } from '@teamsuzie/webmail-learn';
import { minimalRoute, OPERATION_NAMES, type OperationName } from '@teamsuzie/webmail-routes';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertStore, type Alert } from './alerts.js';
import { SqliteApprovalStore } from './approval-store.js';
import type { AgentConfig } from './config.js';
import { openAgentDb } from './db.js';
import { AccountHandler, type HandlerClient, type HandlerRuntime } from './handler.js';
import { HealthStore } from './health.js';
import { JobService, type JobView } from './jobs.js';
import { LayoutBaselineStore } from './layout.js';
import { NewMailStore } from './new-mail.js';
import { exampleConfig, manualClock } from './test-support.js';

const ADDRESS = 'me@firm.com';

const message = (id: string, from = 'bob@other.org'): EmailMessage => ({
    id, threadId: `t-${id}`, subject: `Subject ${id}`, from, to: null, date: '2026-10-26T09:00:00.000Z', bodyPreview: 'hi', unread: true,
});

/** A scripted stand-in for the Chrome side. Each behaviour can be replaced per test. */
class FakeRuntime implements HandlerRuntime {
    calls: string[] = [];
    signedInAs = ADDRESS;
    fingerprintValue = 'fp-1';
    loginOutcome: 'completed' | 'timed_out' = 'completed';
    canaryResults: (only?: OperationName[]) => CanaryResult[] = (only) => (only ?? [...OPERATION_NAMES]).map((operation) => ({ operation, outcome: 'passed' }));
    relearnOutcomes: LearnOutcome[] = [];
    clientImpl: Partial<HandlerClient> = {};
    sent: string[] = [];

    async open() { this.calls.push('open'); }
    async close() { this.calls.push('close'); }
    async canary(only?: OperationName[]) { this.calls.push(`canary:${(only ?? ['all']).join(',')}`); return this.canaryResults(only); }
    async relearn(operation: OperationName) {
        this.calls.push(`relearn:${operation}`);
        const outcome = this.relearnOutcomes.shift();
        if (!outcome) throw new Error('no scripted relearn outcome');
        return outcome;
    }
    async fingerprint() { return this.fingerprintValue; }
    async login() { this.calls.push('login'); return this.loginOutcome; }
    client(): HandlerClient {
        const self = this;
        const base: HandlerClient = {
            listMessages: async () => ({ messages: [message('m1'), message('m2')] }),
            getMessage: async (id) => message(id),
            getThread: async (id) => ({ id, subject: null, participants: [], messageIds: [], labels: [], unread: false, lastMessageAt: '', snippet: null, messages: [] }),
            send: async (input) => { self.sent.push(input.to); return { queueId: 'q', queued: true }; },
            reply: async (input) => { self.sent.push(input.to!); return { queueId: 'q', queued: true, threadId: 't' }; },
            readAccount: async () => self.signedInAs,
            confirmSent: async () => true,
        };
        return { ...base, ...this.clientImpl };
    }
}

const relearned = (untested: OperationName[] = []): LearnOutcome => ({
    ok: true, changed: true, route: { ...minimalRoute(), route_version: '2026-10-26.1' }, notes: ['Renamed button.'], changedStates: [], untested,
});

let runtime: FakeRuntime;
let handler: AccountHandler;
let jobs: JobService;
let health: HealthStore;
let newMail: NewMailStore;
let alerts: Alert[];
let config: AgentConfig;
const clock = manualClock();

function makeHandler() {
    const db = openAgentDb(':memory:');
    const queue = new JobQueue({ storage: SqliteJobStorage.open({ db }), now: () => clock.now().toISOString() });
    const approvalStore = new SqliteApprovalStore(db, clock.now);
    newMail = new NewMailStore(db, clock.now);
    jobs = new JobService({ queue, approvals: new ApprovalQueue({ store: approvalStore }), approvalStore, config, newMail, now: clock.now, approvalNeeded: async () => undefined });
    health = new HealthStore(db, clock.now);
    alerts = [];
    handler = new AccountHandler({
        account: { address: ADDRESS, provider: 'outlook' },
        config, queue, jobs, runtime, health,
        alerts: new AlertStore(db, [{ notify: async (a) => { alerts.push(a); } }], clock.now),
        newMail,
        layout: new LayoutBaselineStore(db, clock.now),
        now: clock.now,
        random: () => 0.5,
        sleep: async () => undefined,
        log: () => undefined,
        idleMs: 0,
    });
}

/** Boot, then run the scheduled work (first inbox check and first canary) so later ticks only run agent jobs. */
async function bootAndSettle() {
    await handler.boot();
    while ((await handler.tick()) === 'ran') { /* drain scheduled work */ }
    runtime.calls = [];
    alerts.length = 0;
}

async function runJob(kind: string, params: unknown, extra: { timeout_seconds?: number; urgent?: boolean } = {}): Promise<JobView> {
    const { job_id } = await jobs.submit('ops-agent', { account: ADDRESS, kind, params, ...extra });
    await handler.tick();
    return (await jobs.view(job_id))!;
}

beforeEach(() => {
    clock.set('2026-10-26T10:00:00.000Z');
    config = { ...exampleConfig(), volume: { ...exampleConfig().volume, quiet_hours: { start: '22:30', end: '07:00' } }, timezone: 'Europe/London' };
    runtime = new FakeRuntime();
    makeHandler();
});

describe('AccountHandler', () => {
    it('boots, checks the account, runs the first inbox check and canary, and records new mail', async () => {
        await handler.boot();
        expect(handler.state().status).toBe('ready');
        await handler.tick(); // canary
        await handler.tick(); // check_inbox
        expect(runtime.calls).toContain('canary:all');
        expect(newMail.list({ after: 0, limit: 10 }).items.map((i) => i.id)).toEqual(['m1', 'm2']);
    });

    it('runs a job and stores its result', async () => {
        await bootAndSettle();
        const view = await runJob('read_message', { message_id: 'm7' });
        expect(view).toMatchObject({ status: 'done', result: { message: { id: 'm7' } } });
    });

    it('fails a job whose deadline has passed', async () => {
        await bootAndSettle();
        const { job_id } = await jobs.submit('ops-agent', { account: ADDRESS, kind: 'read_message', params: { message_id: 'm1' }, timeout_seconds: 5 });
        clock.advance(10_000);
        await handler.tick();
        expect(await jobs.view(job_id)).toMatchObject({ status: 'failed', error: { code: 'job_timeout' } });
    });

    it('fails jobs at once while the operation they need is broken', async () => {
        await bootAndSettle();
        health.set(ADDRESS, 'open_message', { state: 'broken', last_error: 'gone' });
        expect(await runJob('reply', { message_id: 'm1', body: 'x', to: 'bob@other.org' })).toMatchObject({ status: 'failed', error: { code: 'route_broken' } });
        expect(runtime.calls).toEqual([]);
    });

    it('retries once when the canary shows a failure was a one-off', async () => {
        await bootAndSettle();
        let calls = 0;
        runtime.clientImpl.getMessage = async (id) => {
            if (calls++ === 0) throw new RouteError('target_not_found', 'open_message', 1, 'flaky');
            return message(id);
        };
        expect(await runJob('read_message', { message_id: 'm1' })).toMatchObject({ status: 'done' });
        expect(runtime.calls).toEqual(['canary:open_message']);
        expect(health.get(ADDRESS, 'open_message').state).toBe('healthy');
    });

    it('relearns an operation that fails its canary, alerts, and retries the job', async () => {
        await bootAndSettle();
        let calls = 0;
        runtime.clientImpl.listMessages = async () => {
            if (calls++ === 0) throw new RouteError('target_not_found', 'search', 1, 'search box gone');
            return { messages: [message('m3')] };
        };
        runtime.canaryResults = (only) => (only ?? []).map((operation) => ({ operation, outcome: 'failed', error: { code: 'target_not_found', message: 'search box gone' } }));
        runtime.relearnOutcomes = [{ ok: false, reason: 'model reply unusable' }, relearned()];
        expect(await runJob('search', { query: 'x', limit: 5 })).toMatchObject({ status: 'done', result: { messages: [{ id: 'm3' }] } });
        expect(runtime.calls).toEqual(['canary:search', 'relearn:search', 'relearn:search']);
        expect(health.get(ADDRESS, 'search')).toMatchObject({ state: 'healthy', last_error: null });
        expect(alerts.map((a) => a.kind)).toEqual(['route_relearned']);
    });

    it('marks an operation broken after every relearn attempt fails, alerts, and fails the job with route_broken', async () => {
        await bootAndSettle();
        runtime.clientImpl.getMessage = async () => { throw new RouteError('state_not_reached', 'open_message', 0, 'pane gone'); };
        runtime.canaryResults = (only) => (only ?? []).map((operation) => ({ operation, outcome: 'failed', error: { code: 'state_not_reached', message: 'pane gone' } }));
        runtime.relearnOutcomes = Array.from({ length: config.learner.attempts }, () => ({ ok: false, reason: 'still failing' }) as LearnOutcome);
        expect(await runJob('read_message', { message_id: 'm1' })).toMatchObject({ status: 'failed', error: { code: 'route_broken' } });
        expect(health.get(ADDRESS, 'open_message').state).toBe('broken');
        expect(alerts).toEqual([expect.objectContaining({ kind: 'route_broken', message: expect.stringContaining(`after ${config.learner.attempts} attempts`) })]);
        expect(runtime.calls.filter((c) => c === 'relearn:open_message')).toHaveLength(config.learner.attempts);
    });

    it('repairs list_inbox first when another operation cannot be checked without it', async () => {
        await bootAndSettle();
        let fails = true;
        runtime.clientImpl.getMessage = async (id) => {
            if (fails) { fails = false; throw new RouteError('target_not_found', 'open_message', 1, 'x'); }
            return message(id);
        };
        let listBroken = true;
        runtime.canaryResults = (only) => (only ?? []).map((operation) => {
            if (operation === 'list_inbox') return { operation, outcome: listBroken ? 'failed' : 'passed', error: { code: 'x', message: 'rows gone' } } as CanaryResult;
            return (listBroken ? { operation, outcome: 'skipped', reason: 'list_inbox failed, so there is no message to test with' } : { operation, outcome: 'passed' }) as CanaryResult;
        });
        runtime.relearnOutcomes = [relearned()];
        const original = runtime.relearn.bind(runtime);
        runtime.relearn = async (op) => { listBroken = false; return original(op); };
        expect(await runJob('read_message', { message_id: 'm1' })).toMatchObject({ status: 'done' });
        expect(runtime.calls).toEqual(['canary:open_message', 'canary:list_inbox', 'relearn:list_inbox', 'canary:open_message']);
    });

    it('opens the sign-in window on a sign-out and retries the job', async () => {
        await bootAndSettle();
        let signedOut = true;
        runtime.clientImpl.getMessage = async (id) => {
            if (signedOut) { signedOut = false; throw new NeedsLoginError('signed out'); }
            return message(id);
        };
        expect(await runJob('read_message', { message_id: 'm1' })).toMatchObject({ status: 'done' });
        expect(runtime.calls).toEqual(['close', 'login', 'open']);
        expect(alerts.map((a) => a.kind)).toEqual(['needs_login']);
        expect(handler.state().status).toBe('ready');
    });

    it('waits for sign-in when the window times out, then fails jobs whose deadline passes', async () => {
        await bootAndSettle();
        runtime.clientImpl.getMessage = async () => { throw new NeedsLoginError('signed out'); };
        runtime.loginOutcome = 'timed_out';
        const { job_id } = await jobs.submit('ops-agent', { account: ADDRESS, kind: 'read_message', params: { message_id: 'm1' }, timeout_seconds: 120 });
        await handler.tick();
        expect(handler.state().status).toBe('needs_login');
        expect((await jobs.view(job_id))!.status).toBe('queued');
        clock.advance(200_000);
        await handler.tick();
        expect(await jobs.view(job_id)).toMatchObject({ status: 'failed', error: { code: 'needs_login' } });
        runtime.loginOutcome = 'completed';
        expect(await handler.requestLogin()).toBe('completed');
        expect(handler.state().status).toBe('ready');
    });

    it('stops every job when the browser is signed in to another account', async () => {
        runtime.signedInAs = 'someone@else.com';
        await handler.boot();
        expect(handler.state().status).toBe('account_mismatch');
        expect(alerts.map((a) => a.kind)).toEqual(['account_mismatch']);
        const { job_id } = await jobs.submit('ops-agent', { account: ADDRESS, kind: 'list_inbox', params: { limit: 5 } });
        await handler.tick();
        expect(await jobs.view(job_id)).toMatchObject({ status: 'failed', error: { code: 'account_mismatch' } });
    });

    it('confirms the first send after a send route changed, and stops sending when it is not in Sent', async () => {
        await bootAndSettle();
        health.set(ADDRESS, 'compose_send', { send_unconfirmed: true });
        expect(await runJob('send', { to: 'a@firm.com', subject: 'Hi', body: 'b' })).toMatchObject({ status: 'done', result: { confirmed_in_sent: true } });
        expect(health.get(ADDRESS, 'compose_send').send_unconfirmed).toBe(false);

        health.set(ADDRESS, 'compose_send', { send_unconfirmed: true });
        runtime.clientImpl.confirmSent = async () => false;
        expect(await runJob('send', { to: 'a@firm.com', subject: 'Hi again', body: 'b' })).toMatchObject({ status: 'failed', error: { code: 'send_unconfirmed' } });
        expect(health.get(ADDRESS, 'compose_send').state).toBe('broken');
        expect(health.get(ADDRESS, 'reply').state).toBe('broken');
        expect(alerts.map((a) => a.kind)).toEqual(['send_unconfirmed']);
        expect(await runJob('send', { to: 'a@firm.com', subject: 'Third', body: 'b' })).toMatchObject({ status: 'failed', error: { code: 'route_broken' } });
        expect(runtime.sent).toEqual(['a@firm.com', 'a@firm.com']);
    });

    it('marks a relearned send operation as unconfirmed', async () => {
        await bootAndSettle();
        runtime.canaryResults = (only) => (only ?? [...OPERATION_NAMES]).map((operation) => (operation === 'reply'
            ? { operation, outcome: 'failed', error: { code: 'target_not_found', message: 'no Reply' } }
            : { operation, outcome: 'passed' }) as CanaryResult);
        runtime.relearnOutcomes = [relearned()];
        await handler.requestCanary();
        expect(health.get(ADDRESS, 'reply')).toMatchObject({ state: 'healthy', send_unconfirmed: true });
    });

    it('checks every operation when the inbox layout changes', async () => {
        await bootAndSettle();
        jobs.enqueueInternal(ADDRESS, 'check_inbox', 60_000);
        await handler.tick();
        expect(runtime.calls).toEqual([]);
        runtime.fingerprintValue = 'fp-2';
        jobs.enqueueInternal(ADDRESS, 'check_inbox', 60_000);
        await handler.tick();
        expect(runtime.calls).toEqual(['canary:all']);
        jobs.enqueueInternal(ADDRESS, 'check_inbox', 60_000);
        await handler.tick();
        expect(runtime.calls).toEqual(['canary:all']);
    });

    it('holds non-urgent jobs during quiet hours and runs urgent ones', async () => {
        await bootAndSettle();
        clock.set('2026-10-26T23:00:00.000Z'); // 23:00 in London
        const normal = await runJob('list_inbox', { limit: 5 });
        expect(normal.status).toBe('queued');
        const urgent = await runJob('list_inbox', { limit: 5 }, { urgent: true });
        expect(urgent.status).toBe('done');
    });

    it('puts a job back with a delay when the page will not load', async () => {
        await bootAndSettle();
        runtime.clientImpl.listMessages = async () => { throw new NavigationError('net::ERR_INTERNET_DISCONNECTED'); };
        expect((await runJob('list_inbox', { limit: 5 })).status).toBe('queued');
    });

    it('fails a job with a request the page cannot carry out as invalid_request', async () => {
        await bootAndSettle();
        const { WebmailUnsupportedError } = await import('@teamsuzie/email-webmail');
        runtime.clientImpl.send = async () => { throw new WebmailUnsupportedError('Attachments are not supported yet'); };
        expect(await runJob('send', { to: 'a@firm.com', subject: 'Hi', body: 'b' })).toMatchObject({ status: 'failed', error: { code: 'invalid_request' } });
    });

    it('clears a broken operation when a later canary passes', async () => {
        await bootAndSettle();
        health.set(ADDRESS, 'search', { state: 'broken', last_error: 'x' });
        clock.advance(7 * 3_600_000);
        await handler.tick();
        expect(runtime.calls).toEqual(['canary:all']);
        expect(health.get(ADDRESS, 'search')).toMatchObject({ state: 'healthy', last_error: null });
    });

    it('retries broken operations daily when the canary cannot check them', async () => {
        await bootAndSettle();
        health.set(ADDRESS, 'search', { state: 'broken', last_error: 'x' });
        runtime.canaryResults = (only) => (only ?? [...OPERATION_NAMES]).map((operation) => (operation === 'search'
            ? { operation, outcome: 'skipped', reason: 'the inbox is empty' }
            : { operation, outcome: 'passed' }) as CanaryResult);
        clock.advance(25 * 3_600_000);
        runtime.relearnOutcomes = [relearned()];
        while ((await handler.tick()) === 'ran') { /* run scheduled work */ }
        expect(runtime.calls).toEqual(['canary:all', 'relearn:search']);
        expect(health.get(ADDRESS, 'search').state).toBe('healthy');
    });
});
