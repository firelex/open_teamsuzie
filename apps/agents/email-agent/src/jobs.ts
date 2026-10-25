import { randomUUID } from 'node:crypto';
import type { ApprovalItem, ApprovalQueue } from '@teamsuzie/approvals';
import { emailsIn } from '@teamsuzie/webmail-browser';
import type { JobQueue, JobRecord } from '@teamsuzie/jobs';
import { z } from 'zod';
import type { SqliteApprovalStore } from './approval-store.js';
import type { AgentConfig } from './config.js';
import type { NewMailStore } from './new-mail.js';
import { evaluateSendPolicy } from './policy.js';

export const AGENT_JOB_KINDS = ['list_inbox', 'read_message', 'read_thread', 'search', 'send', 'reply'] as const;
export type AgentJobKind = typeof AGENT_JOB_KINDS[number];
export type JobKindName = AgentJobKind | 'check_inbox';

export const SEND_APPROVAL_ACTION = 'email.send_job';

const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const emailList = z.string().min(1).refine(
    (value) => value.split(/[,;]/).map((p) => p.trim()).filter((p) => p.length > 0).every((p) => ADDRESS.test(p.replace(/^.*<([^>]+)>$/, '$1'))),
    'must be email addresses separated by commas',
);
const limit = z.number().int().min(1).max(100);

/** Parameters each job kind takes. */
export const JOB_PARAM_SCHEMAS = {
    list_inbox: z.object({ limit }).strict(),
    read_message: z.object({ message_id: z.string().min(1) }).strict(),
    read_thread: z.object({ thread_id: z.string().min(1) }).strict(),
    search: z.object({ query: z.string().min(1).max(500), limit }).strict(),
    send: z.object({ to: emailList, cc: emailList.optional(), bcc: emailList.optional(), subject: z.string().min(1).max(500), body: z.string().min(1) }).strict(),
    reply: z.object({ message_id: z.string().min(1), body: z.string().min(1), to: emailList.optional(), cc: emailList.optional() }).strict(),
} satisfies Record<AgentJobKind, z.ZodTypeAny>;

export type JobParams = { [K in AgentJobKind]: z.infer<typeof JOB_PARAM_SCHEMAS[K]> };

export interface JobPayload {
    account: string;
    kind: JobKindName;
    params: Record<string, unknown>;
    agent_id: string;
    timeout_ms: number;
    /** Set when the job enters the queue. */
    deadline: string;
    urgent: boolean;
}

export interface JobMetadata extends Record<string, unknown> {
    agent_id: string;
    /** How the job was allowed to run: `policy:<rule index>`, `human:<reviewer>`, or `not_needed` for reads. */
    approval: string;
}

/** A job failure with a code agents can act on. */
export class JobFailure extends Error {
    override readonly name = 'JobFailure';
    constructor(readonly code: string, message: string) {
        super(message);
    }
}

export type JobStatusView = 'awaiting_approval' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobView {
    job_id: string;
    account: string;
    kind: JobKindName;
    agent_id: string;
    status: JobStatusView;
    created_at: string;
    finished_at: string | null;
    result: unknown;
    error: { code: string; message: string } | null;
    approval: { id: string; status: ApprovalItem['status']; reason: string | null } | null;
}

export interface SubmitInput {
    account: string;
    kind: string;
    params: unknown;
    timeout_seconds?: number;
    urgent?: boolean;
}

export interface JobServiceDeps {
    queue: JobQueue;
    approvals: ApprovalQueue;
    approvalStore: SqliteApprovalStore;
    config: AgentConfig;
    newMail: NewMailStore;
    now: () => Date;
    /** Tell the user a send is waiting for their approval. */
    approvalNeeded: (payload: JobPayload, approvalId: string, reason: string) => Promise<void>;
}

export function accountQueue(address: string): string {
    return `account:${address.toLowerCase()}`;
}

const HOUR = 3_600_000;
// Handlers decide when a job is retried; the queue's own retry limit must never end a job first.
const UNLIMITED_ATTEMPTS = 1_000_000;

/** Submitting, viewing and cancelling jobs on behalf of agents. */
export class JobService {
    constructor(private readonly deps: JobServiceDeps) {}

    async submit(agentId: string, input: SubmitInput): Promise<{ job_id: string; status: 'queued' | 'awaiting_approval'; reason?: string }> {
        const account = this.deps.config.accounts.find((a) => a.address.toLowerCase() === input.account.toLowerCase());
        if (!account) throw new JobFailure('invalid_request', `Unknown account ${input.account}. Known accounts: ${this.deps.config.accounts.map((a) => a.address).join(', ')}`);
        if (!(AGENT_JOB_KINDS as readonly string[]).includes(input.kind)) {
            throw new JobFailure('invalid_request', `Unknown job kind "${input.kind}". Kinds: ${AGENT_JOB_KINDS.join(', ')}`);
        }
        const kind = input.kind as AgentJobKind;
        const parsed = JOB_PARAM_SCHEMAS[kind].safeParse(input.params);
        if (!parsed.success) {
            throw new JobFailure('invalid_request', `Invalid params for ${kind}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ')}`);
        }
        if (input.timeout_seconds !== undefined && (!Number.isFinite(input.timeout_seconds) || input.timeout_seconds <= 0)) {
            throw new JobFailure('invalid_request', 'timeout_seconds must be a positive number');
        }
        const params = { ...parsed.data } as Record<string, unknown>;
        const payload: JobPayload = {
            account: account.address,
            kind,
            params,
            agent_id: agentId,
            timeout_ms: (input.timeout_seconds ?? this.deps.config.default_job_timeout_minutes * 60) * 1000,
            deadline: '',
            urgent: input.urgent === true,
        };
        const jobId = `job-${randomUUID()}`;

        if (kind !== 'send' && kind !== 'reply') {
            this.enqueue(jobId, payload, { agent_id: agentId, approval: 'not_needed' });
            return { job_id: jobId, status: 'queued' };
        }

        let threadParticipants: string[] | null = null;
        if (kind === 'reply') {
            const sender = this.deps.newMail.senderOf(account.address, params.message_id as string);
            threadParticipants = sender === null ? null : [sender];
            // What is sent must be what was decided on: name the recipient now when it is known.
            if (params.to === undefined && sender !== null) params.to = sender;
        }
        const recipients = [...new Set(emailsIn([params.to, params.cc, params.bcc].filter((v) => typeof v === 'string').join(', ')))];
        const decision = evaluateSendPolicy(this.deps.config.send_policy.rules, {
            kind,
            agentId,
            recipients,
            threadParticipants,
            autoSentLastHour: this.autoSentLastHour(agentId),
        });
        if (decision.allowed) {
            this.enqueue(jobId, payload, { agent_id: agentId, approval: `policy:${decision.rule}` });
            return { job_id: jobId, status: 'queued' };
        }
        const item = await this.deps.approvals.propose<JobPayload>({
            subject_id: agentId,
            action_type: SEND_APPROVAL_ACTION,
            payload,
            metadata: { job_id: jobId, reason: decision.reason },
        });
        await this.deps.approvalNeeded(payload, item.id, decision.reason);
        return { job_id: jobId, status: 'awaiting_approval', reason: decision.reason };
    }

    /** Queue an approved send. Called by the approval dispatcher. */
    enqueueApproved(item: ApprovalItem<JobPayload>): void {
        const jobId = item.metadata?.job_id;
        if (typeof jobId !== 'string') throw new Error(`Approval ${item.id} has no job id`);
        if (!item.review) throw new Error(`Approval ${item.id} is being queued without a review`);
        this.enqueue(jobId, item.payload, { agent_id: item.payload.agent_id, approval: `human:${item.review.reviewer_id}` });
    }

    /** Queue the handler's own inbox check. */
    enqueueInternal(account: string, kind: 'check_inbox', timeoutMs: number): JobRecord {
        return this.enqueue(`job-${randomUUID()}`, {
            account, kind, params: {}, agent_id: 'email-agent', timeout_ms: timeoutMs, deadline: '', urgent: false,
        }, { agent_id: 'email-agent', approval: 'not_needed' }, -10);
    }

    async view(jobId: string): Promise<JobView | null> {
        const job = this.deps.queue.get(jobId);
        const approval = await this.deps.approvalStore.findByJobId<JobPayload>(jobId);
        if (job) return jobView(job, approval);
        if (!approval) return null;
        const rejected = approval.status === 'rejected';
        const dispatchFailed = approval.status === 'failed';
        return {
            job_id: jobId,
            account: approval.payload.account,
            kind: approval.payload.kind,
            agent_id: approval.payload.agent_id,
            status: rejected || dispatchFailed ? 'failed' : 'awaiting_approval',
            created_at: approval.created_at.toISOString(),
            finished_at: rejected ? approval.updated_at.toISOString() : null,
            result: null,
            error: rejected
                ? { code: 'approval_rejected', message: approval.review?.reason ?? 'The send was rejected' }
                : dispatchFailed ? { code: 'approval_dispatch_failed', message: approval.dispatch?.error ?? 'Queuing the approved send failed' } : null,
            approval: approvalView(approval),
        };
    }

    /** An agent's jobs, newest first, including sends awaiting approval. */
    async listForAgent(agentId: string, opts: { limit: number }): Promise<JobView[]> {
        const views: JobView[] = [];
        for (const job of this.deps.queue.list({ limit: 500 })) {
            if ((job.metadata as JobMetadata).agent_id === agentId) {
                views.push(jobView(job, await this.deps.approvalStore.findByJobId<JobPayload>(job.id)));
            }
        }
        for (const item of await this.deps.approvals.list({ subject_id: agentId, status: ['pending', 'approved', 'rejected', 'failed'], limit: 200 })) {
            const jobId = item.metadata?.job_id;
            if (typeof jobId === 'string' && !this.deps.queue.get(jobId)) {
                const view = await this.view(jobId);
                if (view) views.push(view);
            }
        }
        return views.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, opts.limit);
    }

    async cancel(agentId: string, jobId: string): Promise<JobView> {
        const view = await this.view(jobId);
        if (!view || view.agent_id !== agentId) throw new JobFailure('invalid_request', `No job ${jobId} for ${agentId}`);
        if (view.status === 'queued') {
            this.deps.queue.cancel(jobId);
        } else if (view.status === 'awaiting_approval' && view.approval?.status === 'pending') {
            await this.deps.approvals.review(view.approval.id, { reviewer_id: `agent:${agentId}`, verdict: 'reject', reason: 'Cancelled by the agent' });
        } else {
            throw new JobFailure('invalid_request', `Job ${jobId} is ${view.status} and can no longer be cancelled`);
        }
        return (await this.view(jobId))!;
    }

    /** Sends this agent made without human approval in the last hour. */
    autoSentLastHour(agentId: string): number {
        const since = this.deps.now().getTime() - HOUR;
        return this.deps.queue.list({ limit: 500 }).filter((job) => {
            const metadata = job.metadata as JobMetadata;
            return (job.kind === 'send' || job.kind === 'reply')
                && metadata.agent_id === agentId
                && metadata.approval.startsWith('policy:')
                && Date.parse(job.createdAt) >= since;
        }).length;
    }

    private enqueue(jobId: string, payload: JobPayload, metadata: JobMetadata, priority?: number): JobRecord {
        const now = this.deps.now();
        return this.deps.queue.enqueue<JobPayload, JobMetadata>({
            id: jobId,
            kind: payload.kind,
            queue: accountQueue(payload.account),
            payload: { ...payload, deadline: new Date(now.getTime() + payload.timeout_ms).toISOString() },
            metadata,
            priority: priority ?? (payload.urgent ? 10 : 0),
            maxAttempts: UNLIMITED_ATTEMPTS,
            availableAt: now,
        });
    }
}

function failureOf(job: JobRecord): { code: string; message: string } {
    if (!job.error?.code) throw new Error(`Job ${job.id} failed without an error code: ${job.error?.message ?? 'no error recorded'}`);
    return { code: job.error.code, message: job.error.message };
}

function approvalView(item: ApprovalItem<JobPayload>): JobView['approval'] {
    const reason = item.review?.reason ?? (typeof item.metadata?.reason === 'string' ? item.metadata.reason : null);
    return { id: item.id, status: item.status, reason };
}

function jobView(job: JobRecord, approval: ApprovalItem<JobPayload> | null): JobView {
    const payload = job.payload as JobPayload;
    const status: JobStatusView = job.status === 'succeeded' ? 'done' : job.status;
    return {
        job_id: job.id,
        account: payload.account,
        kind: payload.kind,
        agent_id: payload.agent_id,
        status,
        created_at: job.createdAt,
        finished_at: job.finishedAt,
        result: job.result,
        // A queued job may carry the reason it was last put back (deferred); only a failed job has an error.
        error: job.status === 'failed' ? failureOf(job) : null,
        approval: approval ? approvalView(approval) : null,
    };
}
