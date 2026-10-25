import { randomUUID } from 'node:crypto';
import {
    addressOf,
    type EmailAccount, type EmailClient, type EmailMessage, type EmailStatus, type EmailThreadDetail,
    type ListEmailMessagesInput, type ListEmailMessagesResult, type QueuedEmailResult, type ReplyEmailInput,
    type SendEmailInput,
} from '@teamsuzie/email';
import {
    emailsIn, RouteError,
    type Behaviour, type ExtractedRecord, type OperationResult, type RouteExecutor, type VolumeLimiter,
} from '@teamsuzie/webmail-browser';
import type { OperationName, Params, ProviderKey, Route } from '@teamsuzie/webmail-routes';
import { OPERATION_OUTPUTS } from './goals.js';

export interface WebmailAccount {
    address: string;
    provider: ProviderKey;
}

export interface WebmailClientDeps {
    account: WebmailAccount;
    executor: RouteExecutor;
    /** The route in use, read before every operation so a relearned route takes effect at once. */
    routes: { current(): Route };
    limiter: VolumeLimiter;
    behaviour: Behaviour;
}

/** A request this client cannot carry out through the webmail page (HTML bodies, attachments, another sender). */
export class WebmailUnsupportedError extends Error {
    override readonly name = 'WebmailUnsupportedError';
}

/**
 * One Gmail or Outlook account, read and written through its web page by the account's route. Reads open real
 * messages (so they become read in the mailbox); sends press the real Send button.
 */
export class WebmailEmailClient implements EmailClient {
    constructor(private readonly deps: WebmailClientDeps) {}

    get account(): WebmailAccount {
        return this.deps.account;
    }

    status(): EmailStatus {
        return { configured: true, fromAccount: this.deps.account.address };
    }

    async listAccounts(): Promise<EmailAccount[]> {
        return [{ email: this.deps.account.address, provider: this.deps.account.provider, owner: 'user' }];
    }

    async listMessages(input: ListEmailMessagesInput = {}): Promise<ListEmailMessagesResult> {
        const search = input.search?.trim();
        const records = search
            ? await this.list('search', { $query: search })
            : await this.list('list_inbox', {});
        const limited = input.limit === undefined ? records : records.slice(0, input.limit);
        return { messages: limited.map((r) => this.summary(r)), limit: input.limit };
    }

    async getMessage(id: string): Promise<EmailMessage> {
        await this.deps.limiter.acquire('open');
        const record = await this.one('open_message', { $message_id: id });
        const body = record.body!;
        await this.deps.behaviour.reading(body.length);
        return {
            id,
            threadId: record.thread_id ?? null,
            subject: record.subject!,
            from: record.from!,
            to: record.to ?? null,
            cc: record.cc ?? null,
            date: record.date!,
            bodyText: body,
            account: this.deps.account.address,
        };
    }

    async getThread(id: string): Promise<EmailThreadDetail> {
        await this.deps.limiter.acquire('open');
        const records = await this.list('read_thread', { $thread_id: id });
        if (records.length === 0) throw new RouteError('extract_invalid', 'read_thread', -1, `thread ${id} showed no messages`);
        const messages: EmailMessage[] = records.map((r) => ({
            id: r.id!,
            threadId: id,
            subject: null,
            from: r.from!,
            to: null,
            date: r.date!,
            bodyText: r.body ?? null,
            account: this.deps.account.address,
        }));
        return {
            id,
            subject: null,
            participants: [...new Set(records.map((r) => r.from!))],
            messageIds: messages.map((m) => m.id),
            labels: [],
            unread: false,
            lastMessageAt: records[records.length - 1]!.date!,
            snippet: null,
            messages,
        };
    }

    async send(input: SendEmailInput): Promise<QueuedEmailResult> {
        this.checkSendable(input);
        await this.deps.limiter.acquire('send');
        await this.run('compose_send', {
            '$draft.to': input.to,
            '$draft.cc': input.cc ?? '',
            '$draft.bcc': input.bcc ?? '',
            '$draft.subject': input.subject,
            '$draft.body': input.body,
        }, 'live');
        return { queueId: `webmail-${randomUUID()}`, queued: true, direct: true };
    }

    async reply(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        this.checkSendable(input);
        if (input.replyAll) throw new WebmailUnsupportedError('Reply all is not supported; pass the recipients in to and use reply');
        const original = await this.getMessage(input.messageId);
        const to = input.to ?? original.from;
        if (!to) throw new WebmailUnsupportedError(`Message ${input.messageId} has no sender to reply to`);
        await this.deps.limiter.acquire('send');
        await this.run('reply', {
            $message_id: input.messageId,
            '$draft.to': to,
            '$draft.cc': input.cc ?? '',
            '$draft.body': input.body,
        }, 'live');
        return { queueId: `webmail-${randomUUID()}`, queued: true, direct: true, threadId: original.threadId ?? undefined };
    }

    /** The address the webmail is signed in as. */
    async readAccount(): Promise<string> {
        return (await this.one('read_account', {})).address!;
    }

    /** True when a message with this subject to these recipients is in Sent. */
    async confirmSent(subject: string, to: string): Promise<boolean> {
        const expected = emailsIn(to);
        const sent = await this.list('check_sent', {});
        return sent.some((r) => r.subject === subject && expected.every((address) => emailsIn(r.to ?? '').includes(address)));
    }

    /** Run one operation in test mode: nothing is sent, drafts are discarded. */
    testOperation(operation: OperationName, params: Params): Promise<OperationResult> {
        return this.run(operation, params, 'test');
    }

    private checkSendable(input: { html?: string; attachments?: unknown[]; fromAccount?: string }): void {
        if (input.html) throw new WebmailUnsupportedError('HTML bodies are not supported; send plain text in body');
        if (input.attachments && input.attachments.length > 0) throw new WebmailUnsupportedError('Attachments are not supported yet');
        if (input.fromAccount && addressOf(input.fromAccount).toLowerCase() !== this.deps.account.address.toLowerCase()) {
            throw new WebmailUnsupportedError(`This client sends only as ${this.deps.account.address}, not ${input.fromAccount}`);
        }
    }

    private async run(operation: OperationName, params: Params, mode: 'live' | 'test'): Promise<OperationResult> {
        const route = this.deps.routes.current();
        const result = await this.deps.executor.run(route, operation, { $account: this.deps.account.address, ...params }, mode);
        if (mode === 'live') checkOutput(operation, result);
        return result;
    }

    private async list(operation: OperationName, params: Params): Promise<ExtractedRecord[]> {
        const result = await this.run(operation, params, 'live');
        return result.extracted[OPERATION_OUTPUTS[operation]!.as] as ExtractedRecord[];
    }

    private async one(operation: OperationName, params: Params): Promise<ExtractedRecord> {
        const result = await this.run(operation, params, 'live');
        return result.extracted[OPERATION_OUTPUTS[operation]!.as] as ExtractedRecord;
    }

    private summary(r: ExtractedRecord): EmailMessage {
        return {
            id: r.id!,
            threadId: r.thread_id ?? null,
            subject: r.subject!,
            from: r.from!,
            to: null,
            date: r.date!,
            bodyPreview: r.snippet ?? null,
            unread: r.unread === 'true',
            account: this.deps.account.address,
        };
    }
}

/**
 * Every operation's result must carry its output contract: an `extract_invalid` route error otherwise, so a
 * route that forgot a field is relearned rather than returning half a message.
 */
export function checkOutput(operation: OperationName, result: OperationResult): void {
    const output = OPERATION_OUTPUTS[operation];
    if (output === null) return;
    const value = result.extracted[output.as];
    const fail = (detail: string) => { throw new RouteError('extract_invalid', operation, -1, detail); };
    if (value === undefined) fail(`the route returns nothing under "${output.as}"`);
    if (output.list !== Array.isArray(value)) fail(`"${output.as}" must be ${output.list ? 'a list' : 'one record'}`);
    const records = Array.isArray(value) ? value : [value as ExtractedRecord];
    records.forEach((record, i) => {
        for (const field of output.required) {
            if (record[field] === undefined || record[field] === null) fail(`record ${i} of "${output.as}" has no "${field}"`);
        }
    });
}
