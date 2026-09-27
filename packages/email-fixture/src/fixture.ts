import { z } from 'zod';
import type {
    ChangesResult,
    CreateDraftInput,
    EmailAttachment,
    EmailChange,
    EmailClient,
    EmailMessage,
    EmailStatus,
    EmailThread,
    EmailThreadDetail,
    ForwardEmailInput,
    ListThreadsInput,
    ListThreadsResult,
    QueuedEmailResult,
    ReplyEmailInput,
    SendEmailInput,
} from '@teamsuzie/email';

const isoDate = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)), 'is not an ISO date');

const FixtureMessageSchema = z.object({
    id: z.string().min(1),
    threadId: z.string().min(1).optional(),
    subject: z.string().nullable(),
    from: z.string().min(1),
    to: z.string().min(1),
    cc: z.string().nullable().optional(),
    date: isoDate,
    bodyText: z.string().nullable().optional(),
    bodyHtml: z.string().nullable().optional(),
    inReplyToId: z.string().nullable().optional(),
    messageIdHeader: z.string().nullable().optional(),
    unread: z.boolean(),
    attachments: z.array(z.object({
        filename: z.string().min(1),
        contentType: z.string().min(1),
        size: z.number().int().nonnegative().optional(),
        content: z.string().optional(),
    })).optional(),
});

const FixtureMailboxSchema = z.object({
    account: z.string().email(),
    threads: z.array(z.object({
        id: z.string().min(1),
        labels: z.array(z.string()),
        messages: z.array(FixtureMessageSchema).min(1),
    })),
});

export type FixtureMessage = z.input<typeof FixtureMessageSchema>;
export type FixtureMailbox = z.input<typeof FixtureMailboxSchema>;

interface StoredThread {
    id: string;
    labels: string[];
    messages: Array<EmailMessage & { unread: boolean; date: string }>;
}

export type FixtureSent =
    | { kind: 'send'; input: SendEmailInput }
    | { kind: 'reply'; input: ReplyEmailInput }
    | { kind: 'reply_all'; input: ReplyEmailInput }
    | { kind: 'forward'; input: ForwardEmailInput };

const addresses = (list: string | null | undefined): string[] =>
    (list ?? '').split(',').map((a) => a.trim()).filter(Boolean);

const withoutContent = (m: EmailMessage): EmailMessage => ({
    ...m,
    ...(m.attachments ? { attachments: m.attachments.map(({ content: _content, ...rest }) => rest) } : {}),
});

/**
 * A mailbox held in memory, loaded from a JSON file. It behaves like a real
 * provider for everything a host reads, and tests can change it from the
 * outside with `deliver`. Sending appends the message to its thread and
 * records the call in `sent`; approval is the host's job, so
 * `approvalPolicy` is ignored.
 */
export class FixtureEmailClient implements EmailClient {
    readonly account: string;
    readonly sent: FixtureSent[] = [];
    private readonly threads = new Map<string, StoredThread>();
    private readonly changes: EmailChange[] = [];
    private outboundCount = 0;

    constructor(mailbox: FixtureMailbox) {
        const parsed = FixtureMailboxSchema.safeParse(mailbox);
        if (!parsed.success) throw new Error(`Fixture mailbox is invalid: ${describeIssue(mailbox, parsed.error)}`);
        this.account = parsed.data.account;
        const seen = new Set<string>();
        for (const t of parsed.data.threads) {
            for (const m of t.messages) {
                if (seen.has(m.id)) throw new Error(`Fixture mailbox is invalid: message id ${m.id} is used more than once`);
                seen.add(m.id);
                if (m.threadId !== undefined && m.threadId !== t.id) throw new Error(`Fixture mailbox is invalid: thread ${t.id} message ${m.id}: threadId is ${m.threadId}`);
            }
            this.threads.set(t.id, { id: t.id, labels: [...t.labels], messages: t.messages.map((m) => ({ ...m, threadId: t.id, labels: [...t.labels] })) });
        }
    }

    status(): EmailStatus {
        return { configured: true, reachable: true, fromAccount: this.account };
    }

    async probe(): Promise<boolean> {
        return true;
    }

    /** Adds a message as if it had just arrived. A new thread id creates the thread. */
    deliver(threadId: string, message: FixtureMessage): void {
        const m = FixtureMessageSchema.parse(message);
        if (this.findMessage(m.id)) throw new Error(`message id ${m.id} is already in the mailbox`);
        const thread = this.threads.get(threadId) ?? { id: threadId, labels: ['INBOX'], messages: [] };
        this.threads.set(threadId, thread);
        thread.messages.push({ ...m, threadId, labels: [...thread.labels] });
        this.changes.push({ kind: 'message_added', threadId, messageId: m.id });
    }

    async listThreads(input: ListThreadsInput = {}): Promise<ListThreadsResult> {
        const all = [...this.threads.values()]
            .map((t) => this.summary(t))
            .filter((t) => !input.labels || input.labels.every((l) => t.labels.includes(l)))
            .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
        const start = input.pageToken ? Number(input.pageToken) : 0;
        if (!Number.isInteger(start) || start < 0) throw new Error(`pageToken ${input.pageToken} is not one this mailbox issued`);
        const limit = input.limit ?? all.length;
        const end = start + limit;
        return { threads: all.slice(start, end), nextPageToken: end < all.length ? String(end) : null };
    }

    async getThread(id: string): Promise<EmailThreadDetail> {
        const t = this.thread(id);
        return { ...this.summary(t), messages: t.messages.map(withoutContent) };
    }

    async getMessage(id: string): Promise<EmailMessage> {
        const found = this.findMessage(id);
        if (!found) throw new Error(`message ${id} is not in the mailbox`);
        return withoutContent(found.message);
    }

    async setRead(messageIds: string[], read: boolean): Promise<void> {
        for (const id of messageIds) {
            const found = this.findMessage(id);
            if (!found) throw new Error(`message ${id} is not in the mailbox`);
            found.message.unread = !read;
            this.changes.push({ kind: 'read_changed', threadId: found.thread.id, messageId: id, unread: !read });
        }
    }

    async modifyLabels(threadId: string, add: string[], remove: string[]): Promise<void> {
        const t = this.thread(threadId);
        t.labels = [...t.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !t.labels.includes(l))];
        for (const m of t.messages) {
            m.labels = [...t.labels];
            this.changes.push({ kind: 'labels_changed', threadId, messageId: m.id, labels: [...t.labels] });
        }
    }

    async changesSince(cursor: string | null): Promise<ChangesResult> {
        if (cursor === null) return { changes: [], cursor: String(this.changes.length) };
        const from = Number(cursor);
        if (!Number.isInteger(from) || from < 0 || from > this.changes.length) throw new Error(`cursor ${cursor} is not one this mailbox issued`);
        return { changes: this.changes.slice(from), cursor: String(this.changes.length) };
    }

    async openAttachment(messageId: string, filename: string): Promise<EmailAttachment> {
        const found = this.findMessage(messageId);
        if (!found) throw new Error(`message ${messageId} is not in the mailbox`);
        const a = found.message.attachments?.find((x) => x.filename === filename);
        if (!a || a.content === undefined) throw new Error(`message ${messageId} has no attachment ${filename}`);
        return { ...a };
    }

    async createDraft(_input: CreateDraftInput): Promise<{ draftId: string }> {
        return { draftId: `draft-${++this.outboundCount}` };
    }

    async send(input: SendEmailInput): Promise<QueuedEmailResult> {
        this.sent.push({ kind: 'send', input });
        const threadId = `sent-${this.outboundCount + 1}`;
        this.appendOutbound(threadId, { subject: input.subject, to: input.to, cc: input.cc ?? null, bodyText: input.body, bodyHtml: input.html ?? null, inReplyToId: null });
        return this.queued();
    }

    async reply(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.answer(input, 'reply');
    }

    async replyAll(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.answer(input, 'reply_all');
    }

    async forward(input: ForwardEmailInput): Promise<QueuedEmailResult> {
        const found = this.findMessage(input.messageId);
        if (!found) throw new Error(`message ${input.messageId} is not in the mailbox`);
        this.sent.push({ kind: 'forward', input });
        this.appendOutbound(found.thread.id, {
            subject: `FW: ${stripPrefix(found.message.subject)}`, to: input.to, cc: input.cc ?? null,
            bodyText: [input.body ?? '', '', '---------- Forwarded message ----------', found.message.bodyText ?? ''].join('\n'), bodyHtml: null, inReplyToId: input.messageId,
        });
        return this.queued();
    }

    private answer(input: ReplyEmailInput, kind: 'reply' | 'reply_all'): QueuedEmailResult {
        const found = this.findMessage(input.messageId);
        if (!found) throw new Error(`message ${input.messageId} is not in the mailbox`);
        this.sent.push({ kind, input });
        const original = found.message;
        const others = kind === 'reply_all'
            ? [...addresses(original.to), ...addresses(original.cc)].filter((a) => a !== this.account && a !== original.from)
            : [];
        this.appendOutbound(found.thread.id, {
            subject: `RE: ${stripPrefix(original.subject)}`, to: original.from ?? '', cc: others.length ? others.join(', ') : null,
            bodyText: input.body, bodyHtml: input.html ?? null, inReplyToId: input.messageId,
        });
        return this.queued();
    }

    private appendOutbound(threadId: string, m: { subject: string; to: string; cc: string | null; bodyText: string; bodyHtml: string | null; inReplyToId: string | null }): void {
        const id = `out-${++this.outboundCount}`;
        const thread = this.threads.get(threadId) ?? { id: threadId, labels: ['SENT'], messages: [] };
        this.threads.set(threadId, thread);
        thread.messages.push({ id, threadId, from: this.account, date: new Date().toISOString(), unread: false, labels: [...thread.labels], ...m });
        this.changes.push({ kind: 'message_added', threadId, messageId: id });
    }

    private queued(): QueuedEmailResult {
        return { queueId: `fixture-${this.outboundCount}`, queued: true, direct: true };
    }

    private summary(t: StoredThread): EmailThread {
        const latest = t.messages.reduce((a, b) => (b.date > a.date ? b : a));
        const participants = [...new Set(t.messages.flatMap((m) => [m.from ?? '', ...addresses(m.to), ...addresses(m.cc)]).filter(Boolean))];
        return {
            id: t.id,
            subject: t.messages[0]!.subject,
            participants,
            messageIds: t.messages.map((m) => m.id),
            labels: [...t.labels],
            unread: t.messages.some((m) => m.unread),
            lastMessageAt: latest.date,
            snippet: (latest.bodyText ?? '').slice(0, 140) || null,
        };
    }

    private thread(id: string): StoredThread {
        const t = this.threads.get(id);
        if (!t) throw new Error(`thread ${id} is not in the mailbox`);
        return t;
    }

    private findMessage(id: string): { thread: StoredThread; message: StoredThread['messages'][number] } | null {
        for (const thread of this.threads.values()) {
            const message = thread.messages.find((m) => m.id === id);
            if (message) return { thread, message };
        }
        return null;
    }
}

function stripPrefix(subject: string | null): string {
    return (subject ?? '').replace(/^((re|fw|fwd):\s*)+/i, '');
}

/** "thread t2 message m3: date is not an ISO date", from a zod issue path such as ['threads', 1, 'messages', 0, 'date']. */
function describeIssue(mailbox: FixtureMailbox, error: z.ZodError): string {
    const issue = error.issues[0]!;
    const [top, ti, , mi, ...field] = issue.path;
    if (top === 'threads' && typeof ti === 'number') {
        const thread = mailbox.threads[ti];
        const where = typeof mi === 'number' ? `thread ${thread?.id ?? ti} message ${thread?.messages[mi]?.id ?? mi}` : `thread ${thread?.id ?? ti}`;
        return `${where}: ${field.length ? `${field.join('.')} ` : ''}${issue.message}`;
    }
    return `${issue.path.join('.') || 'mailbox'}: ${issue.message}`;
}
