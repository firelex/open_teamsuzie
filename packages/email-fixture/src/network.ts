import type {
    ChangesResult,
    EmailAttachment,
    EmailChange,
    EmailClient,
    EmailMessage,
    EmailStatus,
    EmailThread,
    EmailThreadDetail,
    ListThreadsInput,
    ListThreadsResult,
    QueuedEmailResult,
    ReplyEmailInput,
    SendEmailInput,
} from '@teamsuzie/email';
import { addressOf, splitAddressList } from '@teamsuzie/email';

type Stored = EmailMessage & { id: string; threadId: string; date: string; unread: boolean; labels: string[]; attachments: EmailAttachment[] };

/** What a message carries between mailboxes, before each mailbox gives it its own id and labels. */
interface Envelope { from: string; to: string; cc: string | null; subject: string; bodyText: string; bodyHtml: string | null; attachments: EmailAttachment[]; date: string }

/**
 * Several in-memory mailboxes joined by one pretend mail system, for testing hosts where two accounts write to each
 * other (one agent's mailbox emailing another's). Mail sent from a mailbox on the network arrives, unread and in the
 * INBOX, in every recipient mailbox on the network (To and Cc), with its attachments; the sender keeps a read copy in
 * SENT. A reply stays in its conversation on both sides. Conversation ids are shared by the whole network ("c1", "c2",
 * …); message ids are unique per mailbox. Recipients not on the network receive nothing. Approval is the host's job, so
 * `approvalPolicy` is ignored.
 */
export class FixtureMailNetwork {
    private readonly boxes = new Map<string, NetworkMailbox>();
    private conversations = 0;

    /** The mailbox at this address, created empty the first time it is asked for. */
    mailbox(address: string): NetworkMailbox {
        const key = addressOf(address).toLowerCase();
        let box = this.boxes.get(key);
        if (!box) {
            box = new NetworkMailbox(key, this);
            this.boxes.set(key, box);
        }
        return box;
    }

    /** @internal Called by a mailbox that sends: files the sender's copy and delivers to every recipient on the network. */
    post(from: NetworkMailbox, conversation: string | null, envelope: Envelope): string {
        const threadId = conversation ?? `c${++this.conversations}`;
        from.file(threadId, envelope, 'outbound');
        const recipients = new Set([...splitAddressList(envelope.to), ...splitAddressList(envelope.cc)].map((a) => addressOf(a).toLowerCase()));
        recipients.delete(from.account);
        for (const r of recipients) this.boxes.get(r)?.file(threadId, envelope, 'inbound');
        return threadId;
    }
}

/** One mailbox on a FixtureMailNetwork. */
export class NetworkMailbox implements EmailClient {
    private readonly threads = new Map<string, Stored[]>();
    private readonly changes: EmailChange[] = [];
    private count = 0;
    /** How many emails this mailbox has sent. */
    sent = 0;

    constructor(readonly account: string, private readonly network: FixtureMailNetwork) {}

    status(): EmailStatus {
        return { configured: true, reachable: true, fromAccount: this.account };
    }

    async probe(): Promise<boolean> {
        return true;
    }

    /** @internal */
    file(threadId: string, e: Envelope, direction: 'inbound' | 'outbound'): void {
        const id = `${threadId}.${++this.count}@${this.account}`;
        const attachments = e.attachments.map((a, i) => ({ ...a, id: `${id}.${i}`, size: a.content === undefined ? a.size : base64Bytes(a.content) }));
        const message: Stored = {
            id, threadId, from: e.from, to: e.to, cc: e.cc, subject: e.subject, bodyText: e.bodyText, bodyHtml: e.bodyHtml, date: e.date,
            unread: direction === 'inbound', labels: [direction === 'inbound' ? 'INBOX' : 'SENT'], attachments, messageIdHeader: `<${id}>`,
        };
        const thread = this.threads.get(threadId) ?? [];
        thread.push(message);
        this.threads.set(threadId, thread);
        this.changes.push({ kind: 'message_added', threadId, messageId: id });
    }

    async listThreads(input: ListThreadsInput = {}): Promise<ListThreadsResult> {
        const all = [...this.threads.entries()]
            .map(([id, messages]) => this.summary(id, messages))
            .filter((t) => !input.labels || input.labels.every((l) => t.labels.includes(l)))
            .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id));
        const start = input.pageToken ? Number(input.pageToken) : 0;
        if (!Number.isInteger(start) || start < 0) throw new Error(`pageToken ${input.pageToken} is not one this mailbox issued`);
        const end = start + (input.limit ?? all.length);
        return { threads: all.slice(start, end), nextPageToken: end < all.length ? String(end) : null };
    }

    async getThread(id: string): Promise<EmailThreadDetail> {
        const messages = this.threads.get(id);
        if (!messages) throw new Error(`thread ${id} is not in ${this.account}`);
        return { ...this.summary(id, messages), messages: messages.map(withoutContent) };
    }

    async getMessage(id: string): Promise<EmailMessage> {
        return withoutContent(this.find(id));
    }

    async setRead(messageIds: string[], read: boolean): Promise<void> {
        for (const id of messageIds) {
            const m = this.find(id);
            m.unread = !read;
            this.changes.push({ kind: 'read_changed', threadId: m.threadId, messageId: id, unread: !read });
        }
    }

    async modifyLabels(threadId: string, add: string[], remove: string[]): Promise<void> {
        const messages = this.threads.get(threadId);
        if (!messages) throw new Error(`thread ${threadId} is not in ${this.account}`);
        for (const m of messages) {
            m.labels = [...m.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !m.labels.includes(l))];
            this.changes.push({ kind: 'labels_changed', threadId, messageId: m.id, labels: [...m.labels] });
        }
    }

    async changesSince(cursor: string | null): Promise<ChangesResult> {
        if (cursor === null) return { changes: [], cursor: String(this.changes.length) };
        const from = Number(cursor);
        if (!Number.isInteger(from) || from < 0 || from > this.changes.length) throw new Error(`cursor ${cursor} is not one this mailbox issued`);
        return { changes: this.changes.slice(from), cursor: String(this.changes.length) };
    }

    async openAttachment(messageId: string, attachmentId: string): Promise<EmailAttachment> {
        const a = this.find(messageId).attachments.find((x) => x.id === attachmentId);
        if (!a || a.content === undefined) throw new Error(`message ${messageId} has no attachment ${attachmentId}`);
        return { ...a };
    }

    async send(input: SendEmailInput): Promise<QueuedEmailResult> {
        const threadId = this.network.post(this, null, {
            from: this.account, to: input.to, cc: input.cc ?? null, subject: input.subject, bodyText: input.body, bodyHtml: input.html ?? null,
            attachments: outbound(input.attachments), date: this.now(),
        });
        return this.queued(threadId);
    }

    async reply(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.answer(input, input.replyAll === true);
    }

    async replyAll(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.answer(input, true);
    }

    private answer(input: ReplyEmailInput, all: boolean): QueuedEmailResult {
        const original = this.find(input.messageId);
        const me = this.account;
        const sender = original.from ?? '';
        const to = input.to ?? (addressOf(sender).toLowerCase() === me ? original.to ?? '' : sender);
        const others = all ? [...splitAddressList(original.to), ...splitAddressList(original.cc)].filter((a) => ![me, addressOf(sender).toLowerCase()].includes(addressOf(a).toLowerCase())) : [];
        const threadId = this.network.post(this, original.threadId, {
            from: me, to, cc: input.cc ?? (others.length ? others.join(', ') : null),
            subject: input.subject ?? `RE: ${(original.subject ?? '').replace(/^((re|fw|fwd):\s*)+/i, '')}`,
            bodyText: input.body, bodyHtml: input.html ?? null, attachments: outbound(input.attachments), date: this.now(),
        });
        return this.queued(threadId);
    }

    /** Strictly increasing times, so mail sent in the same millisecond still sorts in the order it was sent. */
    private last = 0;
    private now(): string {
        this.last = Math.max(Date.now(), this.last + 1);
        return new Date(this.last).toISOString();
    }

    private queued(threadId: string): QueuedEmailResult {
        this.sent++;
        return { queueId: `network-${this.account}-${this.sent}`, queued: true, direct: true, threadId };
    }

    private find(id: string): Stored {
        for (const messages of this.threads.values()) {
            const m = messages.find((x) => x.id === id);
            if (m) return m;
        }
        throw new Error(`message ${id} is not in ${this.account}`);
    }

    private summary(id: string, messages: Stored[]): EmailThread {
        const latest = messages.reduce((a, b) => (b.date > a.date ? b : a));
        const participants = [...new Set(messages.flatMap((m) => [m.from ?? '', ...splitAddressList(m.to), ...splitAddressList(m.cc)]).filter(Boolean).map(addressOf))];
        return {
            id, subject: messages[0]!.subject, participants, messageIds: messages.map((m) => m.id),
            labels: [...new Set(messages.flatMap((m) => m.labels))], unread: messages.some((m) => m.unread),
            lastMessageAt: latest.date, snippet: (latest.bodyText ?? '').slice(0, 140) || null,
        };
    }
}

function outbound(attachments: EmailAttachment[] | undefined): EmailAttachment[] {
    return (attachments ?? []).map((a) => {
        if (a.content === undefined) throw new Error(`Attachment ${a.filename} has no content to send`);
        return { filename: a.filename, contentType: a.contentType, content: a.content };
    });
}

const withoutContent = (m: Stored): EmailMessage => ({ ...m, attachments: m.attachments.map(({ content: _content, ...rest }) => rest) });

/** How many bytes a base64 payload decodes to. */
function base64Bytes(content: string): number {
    const clean = content.replace(/\s/g, '');
    return Math.floor((clean.length * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
}
