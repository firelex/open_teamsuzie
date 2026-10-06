import {
    addressOf, EmailCursorExpiredError, EmailNotFoundError, EmailRateLimitError, splitAddressList,
    type CreateDraftInput, type ForwardEmailInput, type QueuedEmailResult, type ReplyEmailInput, type SendEmailInput,
    type ChangesResult, type EmailAttachment, type EmailChange, type EmailClient, type EmailMessage, type EmailStatus,
    type EmailThread, type EmailThreadDetail, type ListThreadsInput, type ListThreadsResult } from '@teamsuzie/email';
import { buildMime, type MimeInput } from './mime.js';
import { parseGmailMessage, type GmailApiMessage } from './parse.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface HistoryRecord {
    id: string;
    messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
    messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
    labelsAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] }; labelIds: string[] }>;
    labelsRemoved?: Array<{ message: { id: string; threadId: string; labelIds?: string[] }; labelIds: string[] }>;
}

class GmailHttpError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

/**
 * EmailClient over the Gmail REST API for one mailbox. It is handed a function
 * that returns a current access token and never stores tokens. Gmail's label
 * ids are turned into names on the way in and back into ids on the way out.
 */
export class GmailClient implements EmailClient {
    private labelsById: Map<string, string> | null = null;
    private lastError: string | null = null;

    constructor(private readonly opts: { account: string; accessToken: () => Promise<string>; fetch?: typeof fetch }) {}

    status(): EmailStatus {
        return { configured: true, fromAccount: this.opts.account, reachable: this.lastError === null, lastError: this.lastError };
    }

    async probe(): Promise<boolean> {
        await this.call('GET', '/profile');
        return true;
    }

    /** One Gmail API call. Any non-2xx answer throws, naming the call. */
    protected async call<T>(method: string, path: string, opts: { query?: Record<string, string | string[] | undefined>; body?: unknown } = {}): Promise<T> {
        const url = new URL(API + path);
        for (const [k, v] of Object.entries(opts.query ?? {})) {
            if (v === undefined) continue;
            for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
        }
        const res = await (this.opts.fetch ?? fetch)(url, {
            method,
            headers: { authorization: `Bearer ${await this.opts.accessToken()}`, ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
        const text = await res.text();
        if (!res.ok) {
            const parsed = (() => { try { return (JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }).error; } catch { return undefined; } })();
            const detail = parsed?.message ?? text;
            this.lastError = `Gmail ${method} ${path} answered ${res.status}: ${detail}`;
            // Gmail's documented "slow down" answers: 429, and 403 with a rate-limit reason. The account is fine.
            const reasons = (parsed?.errors ?? []).map((e) => e.reason);
            if (res.status === 429 || (res.status === 403 && reasons.some((r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded'))) {
                throw new EmailRateLimitError(this.lastError);
            }
            throw new GmailHttpError(res.status, this.lastError);
        }
        this.lastError = null;
        return (text ? JSON.parse(text) : {}) as T;
    }

    private async labelMap(refresh = false): Promise<Map<string, string>> {
        if (!this.labelsById || refresh) {
            const { labels } = await this.call<{ labels: Array<{ id: string; name: string }> }>('GET', '/labels');
            this.labelsById = new Map(labels.map((l) => [l.id, l.name]));
        }
        return this.labelsById;
    }

    /** A lookup from label id to name that knows every id given; the list is fetched again once if one is new. */
    private async labelName(ids: string[] = []): Promise<(id: string) => string> {
        let map = await this.labelMap();
        if (ids.some((id) => !map.has(id))) map = await this.labelMap(true);
        return (id) => {
            const name = map.get(id);
            if (name === undefined) throw new Error(`Gmail label ${id} is not in the mailbox's label list`);
            return name;
        };
    }

    /**
     * Label ids for names (Gmail compares label names regardless of case). With `create`, a missing label is
     * made; without it (removing a label, filtering by one) a label that does not exist is simply not there.
     */
    private async labelIds(names: string[], create: boolean): Promise<string[]> {
        let map = await this.labelMap();
        const idOf = (m: Map<string, string>, name: string) => [...m].find(([, n]) => n.toLowerCase() === name.toLowerCase())?.[0];
        const out: string[] = [];
        for (const name of names) {
            let id = idOf(map, name);
            if (!id) {
                map = await this.labelMap(true);
                id = idOf(map, name);
            }
            if (!id && !create) continue;
            if (!id) {
                const made = await this.call<{ id: string; name: string }>('POST', '/labels', { body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
                map.set(made.id, made.name);
                id = made.id;
            }
            out.push(id);
        }
        return out;
    }

    private async fullThread(id: string): Promise<EmailThreadDetail> {
        let t: { id: string; messages: GmailApiMessage[] };
        try {
            t = await this.call('GET', `/threads/${encodeURIComponent(id)}`, { query: { format: 'full' } });
        } catch (err) {
            if (err instanceof GmailHttpError && err.status === 404) throw new EmailNotFoundError(`Gmail thread ${id} no longer exists`);
            throw err;
        }
        // Unsent drafts are the user's own work in progress, not mail: they are left out.
        const sent = t.messages.filter((m) => !(m.labelIds ?? []).includes('DRAFT'));
        if (sent.length === 0) throw new EmailNotFoundError(`Gmail thread ${id} holds only unsent drafts`);
        t = { ...t, messages: sent };
        const labelName = await this.labelName(sent.flatMap((m) => m.labelIds ?? []));
        const messages = t.messages.map((m) => parseGmailMessage(m, labelName));
        const last = messages[messages.length - 1]!;
        return {
            id: t.id,
            subject: messages[0]!.subject ?? null,
            participants: [...new Set(messages.flatMap((m) => [m.from, m.to, m.cc]).filter((x): x is string => Boolean(x)))],
            messageIds: messages.map((m) => m.id),
            labels: [...new Set(messages.flatMap((m) => m.labels ?? []))],
            unread: messages.some((m) => m.unread),
            lastMessageAt: new Date(last.date!).toISOString(),
            snippet: t.messages[t.messages.length - 1]!.snippet ?? null,
            messages,
        };
    }

    async listThreads(input: ListThreadsInput = {}): Promise<ListThreadsResult> {
        const page = await this.call<{ threads?: Array<{ id: string }>; nextPageToken?: string }>('GET', '/threads', {
            query: {
                maxResults: String(input.limit ?? 50),
                pageToken: input.pageToken ?? undefined,
                labelIds: input.labels?.length ? await this.labelIds(input.labels, false) : undefined,
            },
        });
        const threads: EmailThread[] = [];
        for (const { id } of page.threads ?? []) {
            const { messages: _messages, ...summary } = await this.fullThread(id);
            threads.push(summary);
        }
        return { threads, nextPageToken: page.nextPageToken ?? null };
    }

    async getThread(id: string): Promise<EmailThreadDetail> {
        return this.fullThread(id);
    }

    async getMessage(id: string): Promise<EmailMessage> {
        const m = await this.call<GmailApiMessage>('GET', `/messages/${encodeURIComponent(id)}`, { query: { format: 'full' } });
        return parseGmailMessage(m, await this.labelName(m.labelIds ?? []));
    }

    async setRead(messageIds: string[], read: boolean): Promise<void> {
        await this.call('POST', '/messages/batchModify', { body: read ? { ids: messageIds, removeLabelIds: ['UNREAD'] } : { ids: messageIds, addLabelIds: ['UNREAD'] } });
    }

    async modifyLabels(threadId: string, add: string[], remove: string[]): Promise<void> {
        await this.call('POST', `/threads/${encodeURIComponent(threadId)}/modify`, { body: { addLabelIds: await this.labelIds(add, true), removeLabelIds: await this.labelIds(remove, false) } });
    }

    async changesSince(cursor: string | null): Promise<ChangesResult> {
        if (cursor === null) {
            const profile = await this.call<{ historyId: string }>('GET', '/profile');
            return { changes: [], cursor: profile.historyId };
        }
        const changes: EmailChange[] = [];
        let pageToken: string | undefined;
        let latest = cursor;
        do {
            let page: { history?: HistoryRecord[]; historyId: string; nextPageToken?: string };
            try {
                page = await this.call('GET', '/history', { query: {
                    startHistoryId: cursor, pageToken,
                    historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
                } });
            } catch (err) {
                if (err instanceof GmailHttpError && err.status === 404) throw new EmailCursorExpiredError(`Gmail no longer keeps history from ${cursor}; the mailbox must be imported again`);
                throw err;
            }
            const labelName = await this.labelName((page.history ?? []).flatMap((h) => [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])].flatMap((l) => l.message.labelIds ?? [])));
            for (const h of page.history ?? []) {
                // Unsent drafts are not mail (see fullThread).
                for (const a of (h.messagesAdded ?? []).filter((x) => !(x.message.labelIds ?? []).includes('DRAFT'))) changes.push({ kind: 'message_added', threadId: a.message.threadId, messageId: a.message.id });
                for (const d of h.messagesDeleted ?? []) changes.push({ kind: 'message_deleted', threadId: d.message.threadId, messageId: d.message.id });
                for (const l of [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])]) {
                    const now = l.message.labelIds ?? [];
                    changes.push({ kind: 'labels_changed', threadId: l.message.threadId, messageId: l.message.id, labels: now.map(labelName) });
                    if (l.labelIds.includes('UNREAD')) changes.push({ kind: 'read_changed', threadId: l.message.threadId, messageId: l.message.id, unread: now.includes('UNREAD') });
                }
            }
            latest = page.historyId;
            pageToken = page.nextPageToken;
        } while (pageToken);
        return { changes, cursor: latest };
    }

    async openAttachment(messageId: string, attachmentId: string): Promise<EmailAttachment> {
        const message = await this.getMessage(messageId);
        const meta = message.attachments?.find((a) => a.id === attachmentId);
        if (!meta) throw new Error(`Message ${messageId} has no attachment ${attachmentId}`);
        const data = await this.call<{ data: string; size: number }>('GET', `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        return { ...meta, size: data.size, content: Buffer.from(data.data, 'base64url').toString('base64') };
    }

    private raw(input: MimeInput): string {
        return Buffer.from(buildMime(input), 'utf8').toString('base64url');
    }

    private async post(input: MimeInput, threadId?: string): Promise<QueuedEmailResult> {
        const sent = await this.call<{ id: string }>('POST', '/messages/send', { body: { raw: this.raw(input), ...(threadId ? { threadId } : {}) } });
        return { queueId: sent.id, queued: true, direct: true };
    }

    /** What a reply needs from the message it answers: the thread and the threading headers. */
    private async answering(messageId: string): Promise<{ original: EmailMessage; references: string; subject: (prefix: 'Re' | 'Fwd') => string }> {
        const raw = await this.call<GmailApiMessage>('GET', `/messages/${encodeURIComponent(messageId)}`, { query: { format: 'full' } });
        const original = parseGmailMessage(raw, await this.labelName(raw.labelIds ?? []));
        if (!original.messageIdHeader) throw new Error(`Message ${messageId} has no Message-ID header, so a reply could not be threaded`);
        const prior = raw.payload.headers?.find((h) => h.name.toLowerCase() === 'references')?.value ?? '';
        const base = (original.subject ?? '').replace(/^\s*((re|fwd?)\s*:\s*)+/i, '');
        return {
            original,
            references: `${prior} ${original.messageIdHeader}`.trim(),
            subject: (prefix) => `${prefix}: ${base}`,
        };
    }

    async send(input: SendEmailInput): Promise<QueuedEmailResult> {
        return this.post({ from: this.opts.account, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.body, html: input.html, attachments: input.attachments?.map((a) => {
            if (!a.content) throw new Error(`Attachment ${a.filename} has no content to send`);
            return { filename: a.filename, contentType: a.contentType, content: a.content };
        }) });
    }

    private async replyTo(input: ReplyEmailInput, all: boolean): Promise<QueuedEmailResult> {
        const { original, references, subject } = await this.answering(input.messageId);
        if (!original.from) throw new Error(`Message ${input.messageId} has no sender to reply to`);
        const me = addressOf(this.opts.account);
        const others = (list: string | null | undefined) => splitAddressList(list).filter((s) => addressOf(s) !== me);
        const to = all ? [original.from, ...others(original.to)].filter((s, i, a) => a.findIndex((x) => addressOf(x) === addressOf(s)) === i) : [original.from];
        const cc = all ? others(original.cc) : [];
        // A host that showed the user a draft passes its recipients and subject, so what is sent is what was shown.
        return this.post({
            from: this.opts.account, to: input.to ?? to.join(', '), cc: input.cc ?? (cc.length ? cc.join(', ') : undefined),
            subject: input.subject ?? subject('Re'), text: input.body, html: input.html,
            inReplyTo: original.messageIdHeader!, references,
        }, original.threadId!);
    }

    async reply(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.replyTo(input, input.replyAll === true);
    }

    async replyAll(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.replyTo(input, true);
    }

    async forward(input: ForwardEmailInput): Promise<QueuedEmailResult> {
        const { original, subject } = await this.answering(input.messageId);
        const attachments = [];
        for (const a of original.attachments ?? []) {
            const opened = await this.openAttachment(original.id, a.id!);
            attachments.push({ filename: opened.filename, contentType: opened.contentType, content: opened.content! });
        }
        const quote = [
            '---------- Forwarded message ----------',
            `From: ${original.from ?? ''}`, `Date: ${original.date ? new Date(original.date).toUTCString() : ''}`,
            `Subject: ${original.subject ?? ''}`, `To: ${original.to ?? ''}`, '', original.bodyText ?? '',
        ].join('\n');
        return this.post({ from: this.opts.account, to: input.to, cc: input.cc, subject: subject('Fwd'), text: `${input.body ?? ''}\n\n${quote}`, attachments });
    }

    async createDraft(input: CreateDraftInput): Promise<{ draftId: string }> {
        const threading = input.inReplyToId ? await this.answering(input.inReplyToId) : null;
        const raw = this.raw({
            from: this.opts.account, to: input.to, cc: input.cc, subject: input.subject, text: input.body, html: input.html,
            inReplyTo: threading?.original.messageIdHeader ?? undefined, references: threading?.references,
        });
        const draft = await this.call<{ id: string }>('POST', '/drafts', { body: { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } } });
        return { draftId: draft.id };
    }

}
