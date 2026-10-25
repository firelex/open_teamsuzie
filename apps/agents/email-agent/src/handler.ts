import type {
    EmailMessage, EmailThreadDetail, ListEmailMessagesInput, ListEmailMessagesResult, QueuedEmailResult,
    ReplyEmailInput, SendEmailInput,
} from '@teamsuzie/email';
import { WebmailUnsupportedError, type CanaryResult } from '@teamsuzie/email-webmail';
import type { JobQueue, JobRecord } from '@teamsuzie/jobs';
import { NavigationError, NeedsLoginError, RouteError, UnreadableValueError } from '@teamsuzie/webmail-browser';
import type { LearnOutcome } from '@teamsuzie/webmail-learn';
import { OPERATION_NAMES, type OperationName, type ProviderKey } from '@teamsuzie/webmail-routes';
import type { AlertStore } from './alerts.js';
import type { AgentConfig } from './config.js';
import type { HealthStore, OpHealth } from './health.js';
import { accountQueue, JobFailure, type JobKindName, type JobPayload, type JobService } from './jobs.js';
import type { LayoutBaselineStore } from './layout.js';
import type { MailSummary, NewMailStore } from './new-mail.js';
import { quietUntil } from './quiet-hours.js';

/** What the handler needs from the account's mail client. */
export interface HandlerClient {
    listMessages(input?: ListEmailMessagesInput): Promise<ListEmailMessagesResult>;
    getMessage(id: string): Promise<EmailMessage>;
    getThread(id: string): Promise<EmailThreadDetail>;
    send(input: SendEmailInput): Promise<QueuedEmailResult>;
    reply(input: ReplyEmailInput): Promise<QueuedEmailResult>;
    readAccount(): Promise<string>;
    confirmSent(subject: string, to: string): Promise<boolean>;
}

/** The browser side of one account. The real one drives Chrome; tests use a fake. */
export interface HandlerRuntime {
    open(): Promise<void>;
    close(): Promise<void>;
    client(): HandlerClient;
    /** Test-mode run of the given operations (all when omitted) against the live account. */
    canary(only?: OperationName[]): Promise<CanaryResult[]>;
    /** One relearn attempt for the operation; a changed route is saved before this returns. */
    relearn(operation: OperationName): Promise<LearnOutcome>;
    /** The layout fingerprint of the inbox page. */
    fingerprint(): Promise<string>;
    /** Visible sign-in window; the headless session must be closed first. */
    login(): Promise<'completed' | 'timed_out'>;
}

export type HandlerStatus = 'starting' | 'ready' | 'logging_in' | 'needs_login' | 'account_mismatch' | 'failed' | 'stopped';

export interface HandlerDeps {
    account: { address: string; provider: ProviderKey };
    config: AgentConfig;
    queue: JobQueue;
    jobs: JobService;
    runtime: HandlerRuntime;
    health: HealthStore;
    alerts: AlertStore;
    newMail: NewMailStore;
    layout: LayoutBaselineStore;
    now: () => Date;
    random: () => number;
    sleep: (ms: number) => Promise<void>;
    log: (message: string) => void;
    /** How long to wait before looking for work again when the queue is empty. */
    idleMs: number;
}

/** Which route operations a job uses. A job whose operation is broken fails at once. */
const OPERATIONS_FOR: Record<JobKindName, OperationName[]> = {
    list_inbox: ['list_inbox'],
    read_message: ['open_message'],
    read_thread: ['read_thread'],
    search: ['search'],
    send: ['compose_send'],
    reply: ['open_message', 'reply'],
    check_inbox: ['list_inbox'],
};

const SEND_OPERATIONS: OperationName[] = ['compose_send', 'reply'];
const DAY = 86_400_000;
const LOGIN_RETRY_MS = 60_000;

/** Thrown when a job must wait for the user to sign in. */
class LoginPending extends Error {}

/**
 * Runs one account: takes its jobs from the queue one at a time and is the only thing that touches its browser.
 * It keeps each route operation's health, repairs operations that fail (canary, then relearning), runs the
 * scheduled inbox check and canary, handles sign-in, and confirms the first send after a send route changes.
 */
export class AccountHandler {
    private status: HandlerStatus = 'starting';
    private failure: string | null = null;
    private chain: Promise<unknown> = Promise.resolve();
    private stopping = false;
    private loopDone: Promise<void> | null = null;
    private nextCheckInbox = 0;
    private nextCanary = 0;
    private nextBrokenRetry = 0;
    /** When each unreadable-value alert was last raised, so the same one is not repeated on every job. */
    private readonly unreadableAlerted = new Map<string, number>();
    private readonly workerId: string;

    constructor(private readonly deps: HandlerDeps) {
        this.workerId = `handler:${deps.account.address}`;
    }

    get address(): string {
        return this.deps.account.address;
    }

    start(): void {
        if (this.loopDone) throw new Error(`The handler for ${this.address} is already running`);
        this.loopDone = this.loop();
    }

    async stop(): Promise<void> {
        this.stopping = true;
        if (this.loopDone) await this.loopDone;
        await this.deps.runtime.close();
        this.status = 'stopped';
    }

    state(): { account: string; provider: ProviderKey; status: HandlerStatus; failure: string | null; operations: Record<OperationName, OpHealth> } {
        return {
            account: this.address,
            provider: this.deps.account.provider,
            status: this.status,
            failure: this.failure,
            operations: Object.fromEntries(OPERATION_NAMES.map((op) => [op, this.deps.health.get(this.address, op)])) as Record<OperationName, OpHealth>,
        };
    }

    /** Open the sign-in window now (e.g. from the CLI). */
    requestLogin(): Promise<'completed' | 'timed_out' | 'mismatch'> {
        return this.exclusive(() => this.login());
    }

    /** Relearn one operation now, whatever its state. */
    requestRelearn(operation: OperationName): Promise<'healthy' | 'broken'> {
        return this.exclusive(() => this.relearnOperation(operation, 'requested from the command line'));
    }

    /** Run the canary on every operation now, repairing what fails. */
    requestCanary(): Promise<CanaryResult[]> {
        return this.exclusive(() => this.canaryAll());
    }

    /** One step of work. Public for tests; the loop calls it. */
    tick(): Promise<'idle' | 'ran'> {
        return this.exclusive(() => this.tickNow());
    }

    /** Opens the browser and checks the signed-in account. Public for tests; the loop calls it. */
    boot(): Promise<void> {
        return this.exclusive(async () => {
            await this.deps.runtime.open();
            await this.verifyAccountOrLogin();
        });
    }

    private async loop(): Promise<void> {
        try {
            await this.boot();
            while (!this.stopping) {
                if ((await this.tick()) === 'idle') await this.deps.sleep(this.deps.idleMs);
            }
        } catch (error) {
            this.status = 'failed';
            this.failure = (error as Error).stack ?? String(error);
            this.log(`stopped by an unexpected error: ${this.failure}`);
            await this.deps.alerts.raise(this.address, 'handler_failed', `The handler for ${this.address} stopped: ${(error as Error).message}`);
        }
    }

    /** Run browser work one piece at a time. */
    private exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.chain.then(fn);
        // The chain only orders work; each caller still gets its own result or error from `run`.
        this.chain = run.then(() => undefined, () => undefined);
        return run;
    }

    private log(message: string): void {
        this.deps.log(`[${this.address}] ${message}`);
    }

    private async tickNow(): Promise<'idle' | 'ran'> {
        if (this.status === 'needs_login' || this.status === 'account_mismatch') {
            this.sweepWaitingJobs();
            return 'idle';
        }
        const now = this.deps.now().getTime();
        if (now >= this.nextCheckInbox) {
            this.deps.jobs.enqueueInternal(this.address, 'check_inbox', this.deps.config.default_job_timeout_minutes * 60_000);
            const [min, max] = this.deps.config.check_inbox_minutes;
            this.nextCheckInbox = now + (min + (max - min) * this.deps.random()) * 60_000;
        }
        if (now >= this.nextCanary) {
            this.nextCanary = now + this.deps.config.canary_interval_hours * 3_600_000 * (0.8 + 0.4 * this.deps.random());
            await this.withLoginHandling(() => this.canaryAll());
            return 'ran';
        }
        if (now >= this.nextBrokenRetry) {
            this.nextBrokenRetry = now + DAY;
            const broken = OPERATION_NAMES.filter((op) => this.deps.health.get(this.address, op).state === 'broken');
            if (broken.length > 0) {
                for (const op of broken) await this.withLoginHandling(() => this.relearnOperation(op, 'daily retry of a broken operation'));
                return 'ran';
            }
        }
        const job = this.deps.queue.claimNext({ queue: accountQueue(this.address), workerId: this.workerId });
        if (!job) return 'idle';
        await this.process(job);
        return 'ran';
    }

    private async process(job: JobRecord): Promise<void> {
        const payload = job.payload as JobPayload;
        const now = this.deps.now();
        if (now.getTime() > Date.parse(payload.deadline)) {
            this.fail(job, new JobFailure('job_timeout', `The job's deadline (${payload.deadline}) passed before it could run`));
            return;
        }
        const quietEnd = payload.urgent ? null : quietUntil(now, this.deps.config.volume.quiet_hours, this.deps.config.timezone);
        if (quietEnd !== null) {
            this.defer(job, quietEnd.getTime() - now.getTime(), 'quiet hours');
            return;
        }
        const broken = OPERATIONS_FOR[payload.kind].find((op) => this.deps.health.get(this.address, op).state === 'broken');
        if (broken !== undefined) {
            this.fail(job, new JobFailure('route_broken', `The ${broken} operation is broken for ${this.address} and could not be relearned: ${this.deps.health.get(this.address, broken).last_error}`));
            return;
        }
        try {
            const result = await this.runWithRecovery(() => this.execute(payload));
            this.deps.queue.markSucceeded(job.id, result);
        } catch (error) {
            await this.handleJobError(job, payload, error);
        }
    }

    private async handleJobError(job: JobRecord, payload: JobPayload, error: unknown): Promise<void> {
        if (error instanceof JobFailure) {
            this.fail(job, error);
        } else if (error instanceof LoginPending) {
            this.defer(job, LOGIN_RETRY_MS, 'waiting for the user to sign in');
        } else if (error instanceof NavigationError) {
            const delay = Math.min(300_000, 15_000 * 2 ** Math.max(0, job.attempts - 1));
            if (this.deps.now().getTime() + delay > Date.parse(payload.deadline)) {
                this.fail(job, new JobFailure('job_timeout', `The webmail could not be loaded before the deadline: ${error.message}`));
            } else {
                this.defer(job, delay, error.message);
            }
        } else if (error instanceof WebmailUnsupportedError) {
            this.fail(job, new JobFailure('invalid_request', error.message));
        } else if (error instanceof UnreadableValueError) {
            this.fail(job, new JobFailure('unreadable_value', error.message));
            await this.alertUnreadable(error.operation, error.message);
        } else {
            this.log(`job ${job.id} hit an unexpected error: ${(error as Error).stack ?? String(error)}`);
            this.fail(job, new JobFailure('internal_error', (error as Error).message));
        }
    }

    private fail(job: JobRecord, failure: JobFailure): void {
        this.log(`job ${job.id} (${job.kind}) failed: ${failure.code}: ${failure.message}`);
        this.deps.queue.markFailed(job.id, failure);
    }

    /** Put the job back in the queue to run after `delayMs`. */
    private defer(job: JobRecord, delayMs: number, reason: string): void {
        this.deps.queue.markFailed(job.id, new JobFailure('deferred', reason), { retryDelayMs: Math.max(0, delayMs) });
    }

    /** While signed out or on the wrong account: fail jobs that can no longer run. */
    private sweepWaitingJobs(): void {
        const now = this.deps.now().getTime();
        for (const job of this.deps.queue.list({ queue: accountQueue(this.address), status: 'queued', limit: 500 })) {
            const payload = job.payload as JobPayload;
            if (this.status === 'account_mismatch') {
                this.fail(job, new JobFailure('account_mismatch', `The browser for ${this.address} is signed in to a different account`));
            } else if (now > Date.parse(payload.deadline)) {
                this.fail(job, new JobFailure('needs_login', `${this.address} needs the user to sign in again, and the job's deadline passed while waiting`));
            }
        }
    }

    private async execute(payload: JobPayload): Promise<unknown> {
        const client = this.deps.runtime.client();
        const p = payload.params;
        switch (payload.kind) {
            case 'list_inbox': {
                const result = await client.listMessages({ limit: p.limit as number });
                this.recordInbox(result);
                return { messages: result.messages };
            }
            case 'read_message':
                return { message: await client.getMessage(p.message_id as string) };
            case 'read_thread':
                return { thread: await client.getThread(p.thread_id as string) };
            case 'search':
                return { messages: (await client.listMessages({ search: p.query as string, limit: p.limit as number })).messages };
            case 'send': {
                const sent = await client.send({ to: p.to as string, cc: p.cc as string | undefined, bcc: p.bcc as string | undefined, subject: p.subject as string, body: p.body as string });
                const confirmed = await this.confirmIfNeeded('compose_send', p.subject as string, p.to as string);
                return { sent: true, confirmed_in_sent: confirmed, queue_id: sent.queueId };
            }
            case 'reply': {
                if (typeof p.to !== 'string') throw new JobFailure('invalid_request', 'A reply needs its recipient in params.to');
                const sent = await client.reply({ messageId: p.message_id as string, body: p.body as string, to: p.to, cc: p.cc as string | undefined });
                // A reply's subject is "Re: " plus the original's. When the original was never seen in the inbox feed,
                // the check matches on recipients alone (an empty subject is contained in every subject).
                const originalSubject = this.deps.newMail.subjectOf(this.address, p.message_id as string);
                const confirmed = await this.confirmIfNeeded('reply', originalSubject === null ? '' : originalSubject, p.to);
                return { sent: true, confirmed_in_sent: confirmed, thread_id: sent.threadId ?? null };
            }
            case 'check_inbox': {
                const result = await client.listMessages({});
                const added = this.recordInbox(result);
                await this.checkLayout();
                return { new_messages: added };
            }
        }
    }

    private recordInbox(result: ListEmailMessagesResult): number {
        const summaries: MailSummary[] = result.messages.map((m) => ({
            id: m.id,
            thread_id: m.threadId ?? null,
            from: m.from!,
            subject: m.subject!,
            date: String(m.date),
            snippet: m.bodyPreview ?? null,
        }));
        return this.deps.newMail.record(this.address, summaries).length;
    }

    /**
     * After a send route changed, the first send is checked in Sent. Returns null when no check was needed. A send
     * that cannot be found stops all sending for the account until the send operations are relearned.
     */
    private async confirmIfNeeded(operation: OperationName, subject: string, to: string): Promise<boolean | null> {
        if (!this.deps.health.get(this.address, operation).send_unconfirmed) return null;
        const found = await this.deps.runtime.client().confirmSent(subject, to);
        if (found) {
            for (const op of SEND_OPERATIONS) this.deps.health.set(this.address, op, { send_unconfirmed: false });
            return true;
        }
        const message = `Send was pressed for ${this.address} after the ${operation} route changed, but the message to ${to} is not in Sent. Sending is stopped until it is relearned.`;
        for (const op of SEND_OPERATIONS) this.deps.health.set(this.address, op, { state: 'broken', last_error: message });
        await this.deps.alerts.raise(this.address, 'send_unconfirmed', message);
        throw new JobFailure('send_unconfirmed', message);
    }

    /** Compare the inbox layout with the accepted one; when it changed, canary everything and accept the new layout. */
    private async checkLayout(): Promise<void> {
        const current = await this.deps.runtime.fingerprint();
        const baseline = this.deps.layout.get(this.address);
        if (baseline === null) {
            this.deps.layout.set(this.address, current);
            return;
        }
        if (baseline === current) return;
        this.log('the inbox layout changed; checking every operation');
        const results = await this.canaryAll();
        if (results.every((r) => r.outcome !== 'failed') && OPERATION_NAMES.every((op) => this.deps.health.get(this.address, op).state !== 'broken')) {
            this.deps.layout.set(this.address, await this.deps.runtime.fingerprint());
        }
    }

    /**
     * Run `fn`; on a route failure repair the operation and run it once more, on a sign-out let the user sign in and
     * run it once more. A second failure ends the job.
     */
    private async runWithRecovery<T>(fn: () => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (error instanceof RouteError) {
                    if (attempt > 0) throw new JobFailure(error.code, `Failed again after the route was checked: ${error.message}`);
                    const operation = error.operation as OperationName;
                    const outcome = await this.repair(operation, error.message);
                    if (outcome === 'broken') throw new JobFailure('route_broken', `The ${operation} operation is broken and could not be relearned: ${error.message}`);
                    if (outcome === 'untestable') throw new JobFailure(error.code, `${error.message} (the inbox is empty, so the operation could not be checked)`);
                    if (outcome === 'unreadable') throw new JobFailure('unreadable_value', `${error.message} (checking the operation found a value the service cannot read)`);
                    continue;
                }
                if (error instanceof NeedsLoginError) {
                    if (attempt > 0) throw new LoginPending(error.message);
                    const login = await this.login();
                    if (login === 'mismatch') throw new JobFailure('account_mismatch', `The browser for ${this.address} is signed in to a different account`);
                    if (login === 'timed_out') throw new LoginPending(error.message);
                    continue;
                }
                throw error;
            }
        }
    }

    /** Like runWithRecovery for maintenance work: a sign-out starts the sign-in flow. */
    private async withLoginHandling<T>(fn: () => Promise<T>): Promise<T | null> {
        try {
            return await fn();
        } catch (error) {
            if (!(error instanceof NeedsLoginError)) throw error;
            await this.login();
            return null;
        }
    }

    /**
     * An operation failed in real use: canary it (a passing canary means the failure was a one-off), and if the
     * canary fails too, relearn it.
     */
    /**
     * The route worked but a value could not be read: relearning cannot help, so tell the user, at most once a day
     * for the same operation and message.
     */
    private async alertUnreadable(operation: string, message: string): Promise<void> {
        const key = `${operation}\n${message}`;
        const now = this.deps.now().getTime();
        const last = this.unreadableAlerted.get(key);
        if (last !== undefined && now - last < DAY) return;
        this.unreadableAlerted.set(key, now);
        await this.deps.alerts.raise(this.address, 'unreadable_value', `${message}. The steps are working; the service cannot read this value, so relearning will not help. This needs a code change.`);
    }

    private async repair(operation: OperationName, error: string): Promise<'healthy' | 'broken' | 'untestable' | 'unreadable'> {
        this.log(`${operation} failed: ${error}`);
        this.deps.health.set(this.address, operation, { state: 'suspect', last_error: error });
        let result = await this.canaryOne(operation);
        if (result.outcome === 'skipped' && operation !== 'list_inbox' && result.reason?.includes('list_inbox failed')) {
            if ((await this.repair('list_inbox', 'the inbox could not be listed while checking another operation')) !== 'healthy') return 'broken';
            result = await this.canaryOne(operation);
        }
        if (result.outcome === 'skipped') return 'untestable';
        if (result.outcome === 'unreadable') {
            this.deps.health.set(this.address, operation, { state: 'healthy' });
            await this.alertUnreadable(operation, result.error!.message);
            return 'unreadable';
        }
        if (result.outcome === 'passed') {
            this.deps.health.set(this.address, operation, { state: 'healthy' });
            return 'healthy';
        }
        return this.relearnOperation(operation, result.error!.message);
    }

    private async canaryOne(operation: OperationName): Promise<CanaryResult> {
        const result = (await this.deps.runtime.canary([operation])).find((r) => r.operation === operation);
        if (!result) throw new Error(`The canary returned no result for ${operation}`);
        return result;
    }

    /** Up to `learner.attempts` relearn attempts; healthy on success, broken (with an alert) when every attempt fails. */
    private async relearnOperation(operation: OperationName, why: string): Promise<'healthy' | 'broken'> {
        this.deps.health.set(this.address, operation, { state: 'relearning' });
        const reasons: string[] = [];
        for (let attempt = 1; attempt <= this.deps.config.learner.attempts; attempt++) {
            this.log(`relearning ${operation} (attempt ${attempt}): ${why}`);
            const outcome = await this.deps.runtime.relearn(operation);
            if (outcome.ok) {
                const now = this.deps.now().toISOString();
                const patch: Partial<OpHealth> = { state: 'healthy', last_error: null, last_relearn_at: now };
                if (outcome.changed && SEND_OPERATIONS.includes(operation)) patch.send_unconfirmed = true;
                this.deps.health.set(this.address, operation, patch);
                if (outcome.changed) {
                    await this.deps.alerts.raise(this.address, 'route_relearned', `The ${operation} route for ${this.deps.account.provider} was relearned (${outcome.route.route_version}): ${outcome.notes.join(' ') || 'no notes'}`);
                    if (outcome.untested.length > 0) await this.canaryAndRepair(outcome.untested);
                }
                return 'healthy';
            }
            reasons.push(outcome.reason);
            this.log(`relearning ${operation} failed: ${outcome.reason}`);
        }
        const message = `The ${operation} operation for ${this.address} could not be relearned after ${this.deps.config.learner.attempts} attempts: ${reasons[reasons.length - 1]}`;
        this.deps.health.set(this.address, operation, { state: 'broken', last_error: message, last_relearn_at: this.deps.now().toISOString() });
        await this.deps.alerts.raise(this.address, 'route_broken', message);
        return 'broken';
    }

    private async canaryAll(): Promise<CanaryResult[]> {
        return this.canaryAndRepair(undefined);
    }

    /** Canary the operations (all when undefined), relearn each that fails, then re-check those that were skipped. */
    private async canaryAndRepair(only: OperationName[] | undefined): Promise<CanaryResult[]> {
        const results = await this.deps.runtime.canary(only);
        for (const result of results) {
            if (result.outcome === 'unreadable') {
                await this.alertUnreadable(result.operation, result.error!.message);
                continue;
            }
            if (result.outcome !== 'failed') {
                if (result.outcome === 'passed' && this.deps.health.get(this.address, result.operation).state !== 'healthy') {
                    this.deps.health.set(this.address, result.operation, { state: 'healthy', last_error: null });
                }
                continue;
            }
            this.deps.health.set(this.address, result.operation, { state: 'suspect', last_error: result.error!.message });
            await this.relearnOperation(result.operation, result.error!.message);
        }
        const skipped = results.filter((r) => r.outcome === 'skipped' && r.reason?.includes('list_inbox failed')).map((r) => r.operation);
        if (skipped.length > 0 && this.deps.health.get(this.address, 'list_inbox').state === 'healthy') {
            for (const result of await this.deps.runtime.canary(skipped)) {
                if (result.outcome === 'failed') await this.relearnOperation(result.operation, result.error!.message);
            }
        }
        return results;
    }

    /** Sign-in through the visible window, then check the account. */
    private async login(): Promise<'completed' | 'timed_out' | 'mismatch'> {
        this.status = 'logging_in';
        await this.deps.alerts.raise(this.address, 'needs_login', `Sign in to ${this.deps.account.provider} as ${this.address} in the Chrome window that has opened.`);
        await this.deps.runtime.close();
        const outcome = await this.deps.runtime.login();
        await this.deps.runtime.open();
        if (outcome === 'timed_out') {
            this.status = 'needs_login';
            this.log('sign-in timed out; jobs wait until `email-agent login` is run');
            return 'timed_out';
        }
        return (await this.verifyAccount()) ? 'completed' : 'mismatch';
    }

    private async verifyAccountOrLogin(): Promise<void> {
        try {
            await this.runWithRecovery(() => this.verifyAccount());
        } catch (error) {
            if (error instanceof LoginPending) return;
            throw error;
        }
    }

    /** True (and ready) when the browser is signed in as the configured address. */
    private async verifyAccount(): Promise<boolean> {
        const signedIn = await this.deps.runtime.client().readAccount();
        if (signedIn.toLowerCase() === this.address.toLowerCase()) {
            this.status = 'ready';
            return true;
        }
        this.status = 'account_mismatch';
        await this.deps.alerts.raise(this.address, 'account_mismatch', `The browser for ${this.address} is signed in as ${signedIn}. Every job for this account fails until \`email-agent login ${this.address}\` signs in to the right account.`);
        return false;
    }
}
