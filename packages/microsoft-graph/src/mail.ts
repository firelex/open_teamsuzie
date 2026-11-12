import {
    EmailAuthError,
    EmailNotFoundError,
    EmailRateLimitError,
    type EmailClient,
    type EmailMessage,
    type EmailStatus,
    type EmailThreadDetail,
    type ForwardEmailInput,
    type ListEmailMessagesInput,
    type ListEmailMessagesResult,
    type QueuedEmailResult,
    type ReplyEmailInput,
    type SendEmailInput,
} from '@teamsuzie/email';
import { GraphError, type GraphSession } from './session.js';

/**
 * Outlook mail through Microsoft Graph, as an @teamsuzie/email client.
 * Ported from Jeff Desk (GraphAgent in jeff_desk/microsoft.py). Reading a
 * message does not mark it read. Sends go out at once: hosts put them
 * behind their approvals, as Jeff Desk does.
 */

interface GraphRecipient {
    emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
    id: string;
    conversationId?: string;
    subject?: string | null;
    from?: GraphRecipient;
    toRecipients?: GraphRecipient[];
    ccRecipients?: GraphRecipient[];
    receivedDateTime?: string;
    sentDateTime?: string;
    bodyPreview?: string;
    isRead?: boolean;
    body?: { contentType?: string; content?: string };
    attachments?: Array<{ id?: string; name?: string; contentType?: string; size?: number }>;
    internetMessageId?: string;
}

/** One of an email's people: name (null when none), address, and place in the email. */
export interface EmailPerson {
    name: string | null;
    address: string;
    role: 'from' | 'to' | 'cc';
}

const SELECT = 'id,conversationId,from,subject,receivedDateTime,sentDateTime,bodyPreview,isRead,toRecipients,ccRecipients,internetMessageId';
const TEXT_BODY = { prefer: 'outlook.body-content-type="text"' };

const address = (r?: GraphRecipient) => r?.emailAddress?.address ?? null;
const addresses = (rs?: GraphRecipient[]) => (rs ?? []).map(address).filter((a): a is string => !!a).join(', ') || null;
const recipients = (text?: string | null) =>
    (text ?? '')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => ({ emailAddress: { address: a } }));

/** Everyone in an email's From, To and Cc. */
export function peopleOf(m: GraphMessage): EmailPerson[] {
    const out: EmailPerson[] = [];
    const add = (r: GraphRecipient | undefined, role: EmailPerson['role']) => {
        const a = r?.emailAddress?.address;
        if (a) out.push({ name: r?.emailAddress?.name?.trim() || null, address: a, role });
    };
    add(m.from, 'from');
    for (const r of m.toRecipients ?? []) add(r, 'to');
    for (const r of m.ccRecipients ?? []) add(r, 'cc');
    return out;
}

export function toEmailMessage(m: GraphMessage, account: string): EmailMessage {
    const body = m.body ?? {};
    return {
        id: m.id,
        account,
        providerMessageId: m.id,
        threadId: m.conversationId ?? null,
        subject: m.subject ?? null,
        from: address(m.from),
        to: addresses(m.toRecipients),
        cc: addresses(m.ccRecipients),
        date: m.receivedDateTime ?? m.sentDateTime ?? null,
        unread: m.isRead === undefined ? undefined : !m.isRead,
        bodyPreview: m.bodyPreview ?? null,
        bodyText: body.contentType === 'text' ? (body.content ?? null) : null,
        bodyHtml: body.contentType === 'html' ? (body.content ?? null) : null,
        attachments: (m.attachments ?? []).map((a) => ({ id: a.id, filename: a.name ?? 'attachment', contentType: a.contentType ?? 'application/octet-stream', size: a.size })),
        messageIdHeader: m.internetMessageId ?? null,
    };
}

/** GraphError mapped onto the email package's errors, so hosts handle every provider alike. */
function asEmailError(err: unknown): unknown {
    if (!(err instanceof GraphError)) return err;
    if (err.code === 'needs_login' || err.code === 'refused') return new EmailAuthError(err.message);
    if (err.code === 'not_found') return new EmailNotFoundError(err.message);
    if (err.code === 'throttled') return new EmailRateLimitError(err.message);
    return err;
}

export class OutlookMailClient implements EmailClient {
    private lastError: string | null = null;

    constructor(
        private readonly session: GraphSession,
        private readonly account: string,
    ) {}

    private async call<T>(fn: () => Promise<T>): Promise<T> {
        try {
            const out = await fn();
            this.lastError = null;
            return out;
        } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            throw asEmailError(err);
        }
    }

    status(): EmailStatus {
        return { configured: true, fromAccount: this.account, reachable: this.lastError === null, lastError: this.lastError };
    }

    async probe(): Promise<boolean> {
        await this.call(() => this.session.request('GET', '/me', { query: { $select: 'id' } }));
        return true;
    }

    /** The inbox newest first, or a search across the mailbox (Graph's $search cannot be ordered). */
    async listMessages(input: ListEmailMessagesInput = {}): Promise<ListEmailMessagesResult> {
        const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
        const found = await this.call(() =>
            input.search
                ? this.session.request<{ value: GraphMessage[] }>('GET', '/me/messages', {
                      query: { $search: JSON.stringify(input.search), $top: limit, $select: SELECT },
                      headers: { consistencylevel: 'eventual' },
                  })
                : this.session.request<{ value: GraphMessage[] }>('GET', '/me/mailFolders/inbox/messages', {
                      query: { $top: limit, $orderby: 'receivedDateTime desc', $select: SELECT },
                  }),
        );
        return { messages: found.value.map((m) => toEmailMessage(m, this.account)), limit };
    }

    async getMessage(id: string): Promise<EmailMessage> {
        const m = await this.call(() =>
            this.session.request<GraphMessage>('GET', `/me/messages/${encodeURIComponent(id)}`, {
                query: { $select: `${SELECT},body`, $expand: 'attachments($select=id,name,contentType,size)' },
                headers: TEXT_BODY,
            }),
        );
        return toEmailMessage(m, this.account);
    }

    async getThread(id: string): Promise<EmailThreadDetail> {
        const found = await this.call(() =>
            this.session.request<{ value: GraphMessage[] }>('GET', '/me/messages', {
                query: { $filter: `conversationId eq '${id.replace(/'/g, "''")}'`, $select: `${SELECT},body` },
                headers: TEXT_BODY,
            }),
        );
        const messages = found.value.map((m) => toEmailMessage(m, this.account)).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
        if (messages.length === 0) throw new EmailNotFoundError(`No conversation ${id} in this mailbox`);
        const participants = [...new Set(messages.flatMap((m) => [m.from, ...(m.to ?? '').split(', '), ...(m.cc ?? '').split(', ')]).filter((a): a is string => !!a))].sort();
        const last = messages[messages.length - 1]!;
        return {
            id,
            subject: messages[0]!.subject,
            participants,
            messageIds: messages.map((m) => m.id),
            labels: [],
            unread: messages.some((m) => m.unread),
            lastMessageAt: String(last.date ?? ''),
            snippet: last.bodyPreview ?? null,
            messages,
        };
    }

    /**
     * Messages in the inbox ('inbox') or sent items ('sentitems') between two
     * ISO times, oldest first, with their people; at most `limit`.
     */
    async between(folder: 'inbox' | 'sentitems', from: string, to: string, limit = 200): Promise<Array<{ message: GraphMessage; people: EmailPerson[] }>> {
        const field = folder === 'inbox' ? 'receivedDateTime' : 'sentDateTime';
        const found = await this.call(() =>
            this.session.all<GraphMessage>(`/me/mailFolders/${folder}/messages`, {
                query: { $filter: `${field} ge ${from} and ${field} lt ${to}`, $orderby: `${field} asc`, $top: 50, $select: SELECT },
                limit,
            }),
        );
        return found.map((message) => ({ message, people: peopleOf(message) }));
    }

    async send(input: SendEmailInput): Promise<QueuedEmailResult> {
        const message: Record<string, unknown> = {
            subject: input.subject,
            body: input.html ? { contentType: 'HTML', content: input.html } : { contentType: 'Text', content: input.body },
            toRecipients: recipients(input.to),
        };
        if (input.cc) message.ccRecipients = recipients(input.cc);
        if (input.bcc) message.bccRecipients = recipients(input.bcc);
        if (input.attachments?.length) {
            message.attachments = input.attachments.map((a) => {
                if (!a.content) throw new Error(`attachment ${a.filename} has no content`);
                return { '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentType: a.contentType, contentBytes: a.content };
            });
        }
        await this.call(() => this.session.request('POST', '/me/sendMail', { body: { message, saveToSentItems: true } }));
        return { queueId: `graph-${Date.now()}`, queued: true, direct: true };
    }

    async reply(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        const payload: Record<string, unknown> = { comment: input.body };
        const message: Record<string, unknown> = {};
        if (input.to) message.toRecipients = recipients(input.to);
        if (input.cc) message.ccRecipients = recipients(input.cc);
        if (Object.keys(message).length) payload.message = message;
        const action = input.replyAll ? 'replyAll' : 'reply';
        await this.call(() => this.session.request('POST', `/me/messages/${encodeURIComponent(input.messageId)}/${action}`, { body: payload }));
        return { queueId: `graph-${Date.now()}`, queued: true, direct: true };
    }

    async replyAll(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.reply({ ...input, replyAll: true });
    }

    async forward(input: ForwardEmailInput): Promise<QueuedEmailResult> {
        // The note on top of the forwarded email; Graph forwards the original with its attachments.
        const payload: Record<string, unknown> = { comment: input.body ?? '', toRecipients: recipients(input.to) };
        if (input.cc) payload.ccRecipients = recipients(input.cc);
        await this.call(() => this.session.request('POST', `/me/messages/${encodeURIComponent(input.messageId)}/forward`, { body: payload }));
        return { queueId: `graph-${Date.now()}`, queued: true, direct: true };
    }
}
