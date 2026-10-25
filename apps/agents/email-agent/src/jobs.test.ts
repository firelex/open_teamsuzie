import { ApprovalQueue } from '@teamsuzie/approvals';
import { JobQueue, SqliteJobStorage } from '@teamsuzie/jobs';
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteApprovalStore } from './approval-store.js';
import type { SendRule } from './config.js';
import { openAgentDb } from './db.js';
import { accountQueue, JobFailure, JobService, SEND_APPROVAL_ACTION, type JobPayload } from './jobs.js';
import { NewMailStore } from './new-mail.js';
import { evaluateSendPolicy } from './policy.js';
import { exampleConfig, manualClock } from './test-support.js';

describe('evaluateSendPolicy', () => {
    const rules: SendRule[] = [
        { allow: ['send', 'reply'], agents: ['ops-agent'], all_recipients_in_domains: ['firm.com'] },
        { allow: ['reply'], agents: ['*'], recipients_already_in_thread: true },
        { max_per_hour: 3, agents: ['*'] },
    ];
    const base = { kind: 'send' as const, agentId: 'ops-agent', recipients: ['a@firm.com'], threadParticipants: null, autoSentLastHour: 0 };

    it('allows a named agent to recipients all inside the domain, including subdomains', () => {
        expect(evaluateSendPolicy(rules, base)).toEqual({ allowed: true, rule: 0 });
        expect(evaluateSendPolicy(rules, { ...base, recipients: ['a@firm.com', 'b@uk.firm.com'] })).toEqual({ allowed: true, rule: 0 });
    });

    it('needs approval when any recipient is outside the domain', () => {
        expect(evaluateSendPolicy(rules, { ...base, recipients: ['a@firm.com', 'x@evilfirm.com'] }).allowed).toBe(false);
        expect(evaluateSendPolicy(rules, { ...base, recipients: ['a@notfirm.com'] }).allowed).toBe(false);
    });

    it('needs approval for an agent no rule names', () => {
        expect(evaluateSendPolicy(rules, { ...base, agentId: 'research-agent' })).toEqual({ allowed: false, reason: expect.stringContaining('no send rule lets research-agent') });
    });

    it('allows any agent to reply to people already in the thread, and only them', () => {
        const reply = { ...base, kind: 'reply' as const, agentId: 'research-agent', recipients: ['bob@other.org'] };
        expect(evaluateSendPolicy(rules, { ...reply, threadParticipants: ['Bob@Other.org'] })).toEqual({ allowed: true, rule: 1 });
        expect(evaluateSendPolicy(rules, { ...reply, threadParticipants: null }).allowed).toBe(false);
        expect(evaluateSendPolicy(rules, { ...reply, recipients: ['bob@other.org', 'eve@other.org'], threadParticipants: ['bob@other.org'] }).allowed).toBe(false);
        expect(evaluateSendPolicy(rules, { ...reply, kind: 'send', threadParticipants: ['bob@other.org'] }).allowed).toBe(false);
    });

    it('needs approval once the hourly cap is reached', () => {
        expect(evaluateSendPolicy(rules, { ...base, autoSentLastHour: 3 })).toEqual({ allowed: false, reason: expect.stringContaining('limit 3') });
    });

    it('needs approval with no rules or no recipients', () => {
        expect(evaluateSendPolicy([], base).allowed).toBe(false);
        expect(evaluateSendPolicy(rules, { ...base, recipients: [] }).allowed).toBe(false);
    });
});

describe('JobService', () => {
    let service: JobService;
    let queue: JobQueue;
    let approvals: ApprovalQueue;
    let newMail: NewMailStore;
    const clock = manualClock();
    const outlook = 'me@firm.com';

    beforeEach(() => {
        const db = openAgentDb(':memory:');
        queue = new JobQueue({ storage: SqliteJobStorage.open({ db }), now: () => clock.now().toISOString() });
        const approvalStore = new SqliteApprovalStore(db, clock.now);
        approvals = new ApprovalQueue({ store: approvalStore });
        newMail = new NewMailStore(db, clock.now);
        service = new JobService({ queue, approvals, approvalStore, config: exampleConfig(), newMail, now: clock.now, approvalNeeded: async () => undefined });
        approvals.registerDispatcher<JobPayload>({
            action_type: SEND_APPROVAL_ACTION,
            dispatch: async (item) => { service.enqueueApproved(item); return { success: true }; },
        });
    });

    it('queues a read on the account queue with a deadline', async () => {
        const submitted = await service.submit('research-agent', { account: 'ME@firm.com', kind: 'read_message', params: { message_id: 'm1' }, timeout_seconds: 60 });
        expect(submitted.status).toBe('queued');
        const job = queue.get(submitted.job_id)!;
        expect(job.queue).toBe(accountQueue(outlook));
        expect((job.payload as JobPayload).deadline).toBe(new Date(clock.now().getTime() + 60_000).toISOString());
        expect(await service.view(submitted.job_id)).toMatchObject({ status: 'queued', kind: 'read_message', agent_id: 'research-agent', error: null });
    });

    it('rejects unknown accounts, kinds and bad params as invalid_request', async () => {
        await expect(service.submit('ops-agent', { account: 'x@y.com', kind: 'list_inbox', params: { limit: 5 } })).rejects.toMatchObject({ code: 'invalid_request' });
        await expect(service.submit('ops-agent', { account: outlook, kind: 'check_inbox', params: {} })).rejects.toBeInstanceOf(JobFailure);
        await expect(service.submit('ops-agent', { account: outlook, kind: 'send', params: { to: 'not an address', subject: 's', body: 'b' } })).rejects.toThrow(/params\.to|to: must be email/);
        await expect(service.submit('ops-agent', { account: outlook, kind: 'list_inbox', params: { limit: 5, extra: 1 } })).rejects.toThrow(/extra|Unrecognized/);
    });

    it('queues a send the policy allows', async () => {
        const submitted = await service.submit('ops-agent', { account: outlook, kind: 'send', params: { to: 'a@firm.com', subject: 'Hi', body: 'Hello' } });
        expect(submitted.status).toBe('queued');
        expect(queue.get(submitted.job_id)!.metadata).toEqual({ agent_id: 'ops-agent', approval: 'policy:0' });
        expect(service.autoSentLastHour('ops-agent')).toBe(1);
    });

    it('holds any other send for approval; approving queues it with the same id', async () => {
        const submitted = await service.submit('ops-agent', { account: outlook, kind: 'send', params: { to: 'a@firm.com, x@gmail.com', subject: 'Hi', body: 'Hello' } });
        expect(submitted).toMatchObject({ status: 'awaiting_approval', reason: expect.stringContaining('x@gmail.com') });
        expect(queue.get(submitted.job_id)).toBeNull();
        const view = (await service.view(submitted.job_id))!;
        expect(view).toMatchObject({ status: 'awaiting_approval', approval: { status: 'pending' } });
        await approvals.review(view.approval!.id, { reviewer_id: 'admin', verdict: 'approve' });
        await approvals.dispatch(view.approval!.id);
        expect(queue.get(submitted.job_id)!.metadata).toEqual({ agent_id: 'ops-agent', approval: 'human:admin' });
        expect((await service.view(submitted.job_id))!.status).toBe('queued');
    });

    it('reports a rejected send as failed with approval_rejected', async () => {
        const submitted = await service.submit('research-agent', { account: outlook, kind: 'send', params: { to: 'a@firm.com', subject: 'Hi', body: 'Hello' } });
        const view = (await service.view(submitted.job_id))!;
        await approvals.review(view.approval!.id, { reviewer_id: 'admin', verdict: 'reject', reason: 'Not now' });
        expect(await service.view(submitted.job_id)).toMatchObject({ status: 'failed', error: { code: 'approval_rejected', message: 'Not now' } });
    });

    it('names the reply recipient from the inbox it has seen, and lets the thread rule allow it', async () => {
        newMail.record(outlook, [{ id: 'm9', thread_id: null, from: 'bob@other.org', subject: 'Q', date: '2026-10-26T09:00:00Z', snippet: null }]);
        const allowed = await service.submit('research-agent', { account: outlook, kind: 'reply', params: { message_id: 'm9', body: 'Yes' } });
        expect(allowed.status).toBe('queued');
        expect((queue.get(allowed.job_id)!.payload as JobPayload).params.to).toBe('bob@other.org');
        const unknown = await service.submit('research-agent', { account: outlook, kind: 'reply', params: { message_id: 'm-unknown', body: 'Yes' } });
        expect(unknown).toMatchObject({ status: 'awaiting_approval', reason: expect.stringContaining('not known') });
    });

    it('lists an agent\'s own jobs, including those awaiting approval, and cancels them', async () => {
        const read = await service.submit('ops-agent', { account: outlook, kind: 'search', params: { query: 'invoice', limit: 5 } });
        clock.advance(1000);
        const held = await service.submit('ops-agent', { account: outlook, kind: 'send', params: { to: 'x@gmail.com', subject: 'Hi', body: 'b' } });
        await service.submit('research-agent', { account: outlook, kind: 'list_inbox', params: { limit: 5 } });
        expect((await service.listForAgent('ops-agent', { limit: 10 })).map((v) => v.job_id)).toEqual([held.job_id, read.job_id]);
        expect((await service.cancel('ops-agent', read.job_id)).status).toBe('cancelled');
        expect(await service.cancel('ops-agent', held.job_id)).toMatchObject({ status: 'failed', error: { code: 'approval_rejected' } });
        await expect(service.cancel('research-agent', read.job_id)).rejects.toMatchObject({ code: 'invalid_request' });
    });
});
