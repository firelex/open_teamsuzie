import {
    addressOf, EmailAuthError, EmailCursorExpiredError, EmailNotFoundError, EmailRateLimitError, splitAddressList,
    type ChangesResult, type EmailAttachment, type EmailChange, type EmailClient, type EmailMessage, type EmailStatus,
    type EmailThread, type EmailThreadDetail, type ListThreadsInput, type ListThreadsResult, type QueuedEmailResult,
    type ReplyEmailInput, type SendEmailInput,
} from '@teamsuzie/email';

/** A persona (user) in the simulator. */
interface SimUser { id: string; email: string; display_name: string }

/** An email as the simulator's native API returns it. Inbox copies leave out `bcc`. */
interface SimEmail {
    seq: number;
    id: string;
    sender_id: string;
    subject: string;
    body: string;
    /** Unix seconds. */
    created: number;
    thread_id: string;
    in_reply_to: string | null;
    to: string[];
    cc: string[];
    bcc?: string[];
    attachments: Array<{ id: string; filename: string; content_type: string; size: number }>;
}

interface SimMailboxPage { messages: SimEmail[]; next_cursor: number; generation: number }

type Folder = 'inbox' | 'sent';

/** The most rows the simulator returns from one mailbox read. */
const PAGE = 1000;

/** The simulator answered with an HTTP error that has no more specific error class. */
export class SimulatorHttpError extends Error {
    override readonly name = 'SimulatorHttpError';
    constructor(readonly status: number, message: string) { super(message); }
}

export interface SimulatorEmailClientOptions {
    /** The simulator's native API, for example http://127.0.0.1:8025. */
    baseUrl: string;
    /** The app key, sent as a bearer token on every call. */
    apiKey: string;
    /** The persona whose mailbox this client is. */
    userId: string;
    /** That persona's email address. */
    address: string;
    fetch?: typeof fetch;
}

/** One message of this mailbox: the email and the folders it is in for this persona. */
interface Held { email: SimEmail; folders: Set<Folder> }

/**
 * EmailClient for one persona's mailbox in the local email simulator, over its native REST API. The simulator has no
 * read flags or labels, so read state and label changes are kept in this client instance only (see README).
 */
export class SimulatorEmailClient implements EmailClient {
    private readonly baseUrl: string;
    private readonly address: string;
    private lastError: string | null = null;
    private usersById: Map<string, SimUser> | null = null;
    /** Population generation last seen; a change means the simulator was reset. */
    private generation: number | null = null;
    /** Inbox messages marked read through setRead. */
    private readonly read = new Set<string>();
    /** Labels set through modifyLabels, by message id; they replace the folder labels. */
    private readonly labelOverrides = new Map<string, string[]>();

    constructor(private readonly opts: SimulatorEmailClientOptions) {
        for (const key of ['baseUrl', 'apiKey', 'userId', 'address'] as const) {
            if (!opts[key]) throw new Error(`SimulatorEmailClient needs ${key}`);
        }
        this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
        this.address = addressOf(opts.address);
    }

    status(): EmailStatus {
        return { configured: true, baseUrl: this.baseUrl, fromAccount: this.address, reachable: this.lastError === null, lastError: this.lastError };
    }

    /** Checks the simulator answers with this app key and that the persona exists with this address. */
    async probe(): Promise<boolean> {
        const users = await this.loadUsers();
        const me = users.get(this.opts.userId);
        if (!me) throw new Error(`The simulator has no persona ${this.opts.userId} in this app`);
        if (addressOf(me.email) !== this.address) throw new Error(`Persona ${this.opts.userId} is ${me.email} in the simulator, not ${this.address}`);
        return true;
    }

    async changesSince(cursor: string | null): Promise<ChangesResult> {
        if (cursor === null) {
            const inbox = await this.readFolder('inbox', 0);
            const sent = await this.readFolder('sent', 0);
            return { changes: [], cursor: formatCursor(sent.generation, inbox.end, sent.end) };
        }
        const from = parseCursor(cursor);
        const inbox = await this.readFolder('inbox', from.inbox);
        const sent = await this.readFolder('sent', from.sent);
        for (const g of [inbox.generation, sent.generation]) {
            if (g !== from.generation) {
                throw new EmailCursorExpiredError(`Cursor ${cursor} is from simulator generation ${from.generation}, but the simulator is at generation ${g} (it was reset): import afresh`);
            }
        }
        const seen = new Set<string>();
        const changes: EmailChange[] = [];
        for (const e of [...inbox.messages, ...sent.messages].sort((a, b) => a.seq - b.seq)) {
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            changes.push({ kind: 'message_added', threadId: e.thread_id, messageId: e.id });
        }
        return { changes, cursor: formatCursor(from.generation, inbox.end, sent.end) };
    }

    async listThreads(input: ListThreadsInput = {}): Promise<ListThreadsResult> {
        this.checkAccount(input.account);
        const threads = await this.threads();
        const summaries: EmailThread[] = [];
        for (const [id, held] of threads) summaries.push(await this.summary(id, held));
        const all = summaries
            .filter((t) => !input.labels || input.labels.every((l) => t.labels.includes(l)))
            .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id));
        const start = input.pageToken ? Number(input.pageToken) : 0;
        if (!Number.isInteger(start) || start < 0) throw new Error(`pageToken ${input.pageToken} is not one this client issued`);
        const end = start + (input.limit ?? all.length);
        return { threads: all.slice(start, end), nextPageToken: end < all.length ? String(end) : null };
    }

    async getThread(id: string): Promise<EmailThreadDetail> {
        const held = (await this.threads()).get(id);
        if (!held) throw new EmailNotFoundError(`Thread ${id} is not in the mailbox of ${this.address}`);
        const messages: EmailMessage[] = [];
        for (const h of held) messages.push(await this.toMessage(h));
        return { ...(await this.summary(id, held)), messages };
    }

    async getMessage(id: string): Promise<EmailMessage> {
        return this.toMessage(await this.held(id));
    }

    /** Client-side only: the simulator keeps no read flags. Every message must be in this mailbox. */
    async setRead(messageIds: string[], read: boolean): Promise<void> {
        for (const id of messageIds) await this.held(id);
        for (const id of messageIds) {
            if (read) this.read.add(id);
            else this.read.delete(id);
        }
    }

    /** Client-side only: the simulator keeps no labels. */
    async modifyLabels(threadId: string, add: string[], remove: string[]): Promise<void> {
        const held = (await this.threads()).get(threadId);
        if (!held) throw new EmailNotFoundError(`Thread ${threadId} is not in the mailbox of ${this.address}`);
        for (const h of held) {
            const labels = this.labelsOf(h);
            this.labelOverrides.set(h.email.id, [...labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !labels.includes(l))]);
        }
    }

    async openAttachment(messageId: string, attachmentId: string): Promise<EmailAttachment> {
        const a = await this.call<{ id: string; filename: string; content_type: string; size: number; content_base64: string }>(
            'GET', `/v1/emails/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        return { id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, content: a.content_base64 };
    }

    async send(input: SendEmailInput): Promise<QueuedEmailResult> {
        this.checkSendable(input);
        const email = await this.post({
            to: await this.idsOf(input.to), cc: await this.idsOf(input.cc), bcc: await this.idsOf(input.bcc),
            subject: input.subject, body: input.body, attachments: outbound(input.attachments),
        });
        return queued(email);
    }

    async reply(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.answer(input, input.replyAll === true);
    }

    async replyAll(input: ReplyEmailInput): Promise<QueuedEmailResult> {
        return this.answer(input, true);
    }

    private async answer(input: ReplyEmailInput, all: boolean): Promise<QueuedEmailResult> {
        this.checkSendable(input);
        const original = await this.getMessage(input.messageId);
        const me = this.address;
        const sender = original.from!;
        const to = input.to ?? (addressOf(sender) === me ? original.to ?? '' : sender);
        const toAddresses = splitAddressList(to).map(addressOf);
        const others = all
            ? [...splitAddressList(original.to), ...splitAddressList(original.cc)].map(addressOf)
                .filter((a, i, list) => a !== me && a !== addressOf(sender) && !toAddresses.includes(a) && list.indexOf(a) === i)
            : [];
        const email = await this.post({
            to: await this.idsOf(to), cc: await this.idsOf(input.cc ?? others.join(', ')), bcc: [],
            subject: input.subject, body: input.body, attachments: outbound(input.attachments), in_reply_to: original.id,
        });
        return queued(email);
    }

    private async post(e: {
        to: string[]; cc: string[]; bcc: string[]; subject: string | undefined; body: string; in_reply_to?: string;
        attachments: Array<{ filename: string; content_type: string; content_base64: string }>;
    }): Promise<SimEmail> {
        if (e.to.length === 0) throw new Error('The email has no recipient in To');
        return this.call<SimEmail>('POST', '/v1/emails', {
            body: {
                sender_id: this.opts.userId, to: e.to, cc: e.cc, bcc: e.bcc, body: e.body, attachments: e.attachments,
                ...(e.subject === undefined ? {} : { subject: e.subject }), ...(e.in_reply_to === undefined ? {} : { in_reply_to: e.in_reply_to }),
            },
        });
    }

    private checkSendable(input: { html?: string; fromAccount?: string }): void {
        if (input.html !== undefined) throw new Error('The simulator sends plain text only; pass the message as body, without HTML');
        if (input.fromAccount !== undefined && addressOf(input.fromAccount) !== this.address) {
            throw new Error(`This client sends as ${this.address}, not ${input.fromAccount}`);
        }
    }

    private checkAccount(account: string | undefined): void {
        if (account !== undefined && addressOf(account) !== this.address) throw new Error(`This client is the mailbox of ${this.address}, not ${account}`);
    }

    /** Persona ids for an address list; an address that is no persona is an error naming it. */
    private async idsOf(list: string | undefined): Promise<string[]> {
        const ids: string[] = [];
        for (const entry of splitAddressList(list)) {
            const address = addressOf(entry);
            const byAddress = (users: Map<string, SimUser>) => [...users.values()].find((u) => addressOf(u.email) === address);
            const user = byAddress(await this.users()) ?? byAddress(await this.loadUsers());
            if (!user) throw new Error(`${address} is not a persona in the simulator, so the email cannot be sent to it`);
            if (!ids.includes(user.id)) ids.push(user.id);
        }
        return ids;
    }

    private async addressOfId(id: string): Promise<string> {
        const user = (await this.users()).get(id) ?? (await this.loadUsers()).get(id);
        if (!user) throw new Error(`The simulator has no persona ${id}`);
        return addressOf(user.email);
    }

    private async users(): Promise<Map<string, SimUser>> {
        return this.usersById ?? this.loadUsers();
    }

    private async loadUsers(): Promise<Map<string, SimUser>> {
        const { users } = await this.call<{ users: SimUser[] }>('GET', '/v1/users');
        this.usersById = new Map(users.map((u) => [u.id, u]));
        return this.usersById;
    }

    /** One message of this mailbox, by its id. */
    private async held(id: string): Promise<Held> {
        const email = await this.call<SimEmail>('GET', `/v1/emails/${encodeURIComponent(id)}`);
        const me = this.opts.userId;
        const folders = new Set<Folder>();
        if ([...email.to, ...email.cc, ...(email.bcc ?? [])].includes(me)) folders.add('inbox');
        if (email.sender_id === me) folders.add('sent');
        if (folders.size === 0) throw new EmailNotFoundError(`Message ${id} is not in the mailbox of ${this.address}`);
        return { email, folders };
    }

    /** Every message of this mailbox, grouped by thread, each thread in send order. */
    private async threads(): Promise<Map<string, Held[]>> {
        const byId = new Map<string, Held>();
        for (const folder of ['inbox', 'sent'] as const) {
            for (const email of (await this.readFolder(folder, 0)).messages) {
                const held = byId.get(email.id);
                if (held) {
                    held.folders.add(folder);
                    // The sent copy carries Bcc; the inbox copy does not.
                    if (folder === 'sent') held.email = email;
                } else {
                    byId.set(email.id, { email, folders: new Set([folder]) });
                }
            }
        }
        const threads = new Map<string, Held[]>();
        for (const held of [...byId.values()].sort((a, b) => a.email.seq - b.email.seq)) {
            const list = threads.get(held.email.thread_id) ?? [];
            list.push(held);
            threads.set(held.email.thread_id, list);
        }
        return threads;
    }

    /** One folder after `after`, every page. */
    private async readFolder(folder: Folder, after: number): Promise<{ messages: SimEmail[]; end: number; generation: number }> {
        const messages: SimEmail[] = [];
        let cursor = after;
        let generation: number;
        for (;;) {
            const page = await this.call<SimMailboxPage>('GET', `/v1/mailboxes/${encodeURIComponent(this.opts.userId)}/messages`, {
                query: { folder, after: String(cursor), limit: String(PAGE) },
            });
            generation = page.generation;
            this.seeGeneration(generation);
            messages.push(...page.messages);
            cursor = page.next_cursor;
            if (page.messages.length < PAGE) break;
        }
        return { messages, end: cursor, generation };
    }

    /** After a reset the simulator's personas are new, so the cached directory is dropped. */
    private seeGeneration(generation: number): void {
        if (this.generation !== null && this.generation !== generation) this.usersById = null;
        this.generation = generation;
    }

    private labelsOf(h: Held): string[] {
        const override = this.labelOverrides.get(h.email.id);
        if (override) return [...override];
        return [...(h.folders.has('inbox') ? ['INBOX'] : []), ...(h.folders.has('sent') ? ['SENT'] : [])];
    }

    private unreadOf(h: Held): boolean {
        return h.folders.has('inbox') && !this.read.has(h.email.id);
    }

    private async toMessage(h: Held): Promise<EmailMessage> {
        const e = h.email;
        const list = async (ids: string[]) => (ids.length ? (await Promise.all(ids.map((id) => this.addressOfId(id)))).join(', ') : null);
        const mine = e.sender_id === this.opts.userId;
        return {
            id: e.id,
            account: this.address,
            providerMessageId: e.id,
            threadId: e.thread_id,
            inReplyToId: e.in_reply_to,
            messageIdHeader: `<${e.id}@sim.test>`,
            from: await this.addressOfId(e.sender_id),
            to: await list(e.to),
            cc: await list(e.cc),
            // Only the sender sees who was blind-copied.
            bcc: mine ? await list(e.bcc ?? []) : null,
            subject: e.subject,
            bodyText: e.body,
            bodyHtml: null,
            bodyPreview: e.body.slice(0, 140),
            date: new Date(e.created * 1000).toISOString(),
            labels: this.labelsOf(h),
            unread: this.unreadOf(h),
            attachments: e.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size })),
        };
    }

    private async summary(id: string, held: Held[]): Promise<EmailThread> {
        const latest = held[held.length - 1]!.email;
        const ids = new Set(held.flatMap((h) => [h.email.sender_id, ...h.email.to, ...h.email.cc]));
        const participants: string[] = [];
        for (const u of ids) participants.push(await this.addressOfId(u));
        return {
            id,
            subject: held[0]!.email.subject,
            participants: [...new Set(participants)],
            messageIds: held.map((h) => h.email.id),
            labels: [...new Set(held.flatMap((h) => this.labelsOf(h)))],
            unread: held.some((h) => this.unreadOf(h)),
            lastMessageAt: new Date(latest.created * 1000).toISOString(),
            snippet: latest.body.slice(0, 140) || null,
        };
    }

    /** One simulator call. Any non-2xx answer throws with the status and the simulator's message. */
    private async call<T>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
        const url = new URL(this.baseUrl + path);
        for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
        const res = await (this.opts.fetch ?? fetch)(url, {
            method,
            headers: { authorization: `Bearer ${this.opts.apiKey}`, ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
        const text = await res.text();
        if (!res.ok) {
            this.lastError = `Simulator ${method} ${path} answered ${res.status}: ${detailOf(text)}`;
            if (res.status === 401 || res.status === 403) throw new EmailAuthError(this.lastError);
            if (res.status === 404) throw new EmailNotFoundError(this.lastError);
            if (res.status === 429) throw new EmailRateLimitError(this.lastError);
            throw new SimulatorHttpError(res.status, this.lastError);
        }
        this.lastError = null;
        return JSON.parse(text) as T;
    }
}

/** The simulator's error text: FastAPI's `detail` (a string, or a list of validation problems), else the raw body. */
function detailOf(text: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text;
    }
    const detail = (parsed as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
    return JSON.stringify(detail ?? parsed);
}

/** The cursor is "<generation>:<inbox seq>:<sent seq>". */
function formatCursor(generation: number, inbox: number, sent: number): string {
    return `${generation}:${inbox}:${sent}`;
}

function parseCursor(cursor: string): { generation: number; inbox: number; sent: number } {
    const m = /^(\d+):(\d+):(\d+)$/.exec(cursor);
    if (!m) throw new Error(`cursor ${cursor} is not one this client issued`);
    return { generation: Number(m[1]), inbox: Number(m[2]), sent: Number(m[3]) };
}

function outbound(attachments: EmailAttachment[] | undefined): Array<{ filename: string; content_type: string; content_base64: string }> {
    return (attachments ?? []).map((a) => {
        if (a.content === undefined) throw new Error(`Attachment ${a.filename} has no content to send`);
        return { filename: a.filename, content_type: a.contentType, content_base64: a.content };
    });
}

function queued(email: SimEmail): QueuedEmailResult {
    return { queueId: email.id, queued: true, direct: true, threadId: email.thread_id };
}
