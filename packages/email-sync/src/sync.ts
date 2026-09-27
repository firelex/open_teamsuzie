import type { EmailClient, EmailMessage, EmailThreadDetail } from '@teamsuzie/email';
import { sanitizeEmailHtml } from './sanitize.js';
import { emailText } from './text.js';

/** One message as the host keeps it. Attachment content is never stored; it is fetched when opened. */
export interface StoredMessage {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    cc: string[];
    subject: string | null;
    /** ISO date. */
    sentAt: string;
    unread: boolean;
    labels: string[];
    direction: 'inbound' | 'outbound';
    /** Sanitised HTML, safe to show; null for plain-text messages. */
    html: string | null;
    text: string;
    /** Offset into `text` where quoted history starts; null when there is none. */
    quotedFrom: number | null;
    attachments: Array<{ filename: string; contentType: string; size: number | null }>;
}

/** Where the host keeps its copy of the mailbox (for example database tables). */
export interface MailStore {
    getCursor(account: string): Promise<string | null>;
    setCursor(account: string, cursor: string): Promise<void>;
    upsertMessage(account: string, m: StoredMessage): Promise<'inserted' | 'updated'>;
    deleteMessage(account: string, messageId: string): Promise<void>;
    setFlags(account: string, messageId: string, flags: { unread?: boolean; labels?: string[] }): Promise<void>;
}

/** A store in memory, for tests and demos. */
export class MemoryMailStore implements MailStore {
    private readonly cursors = new Map<string, string>();
    private readonly byAccount = new Map<string, Map<string, StoredMessage>>();

    messages(account: string): Map<string, StoredMessage> {
        let m = this.byAccount.get(account);
        if (!m) { m = new Map(); this.byAccount.set(account, m); }
        return m;
    }

    async getCursor(account: string): Promise<string | null> {
        return this.cursors.get(account) ?? null;
    }

    async setCursor(account: string, cursor: string): Promise<void> {
        this.cursors.set(account, cursor);
    }

    async upsertMessage(account: string, m: StoredMessage): Promise<'inserted' | 'updated'> {
        const all = this.messages(account);
        const existed = all.has(m.id);
        all.set(m.id, JSON.parse(JSON.stringify(m)) as StoredMessage);
        return existed ? 'updated' : 'inserted';
    }

    async deleteMessage(account: string, messageId: string): Promise<void> {
        this.messages(account).delete(messageId);
    }

    async setFlags(account: string, messageId: string, flags: { unread?: boolean; labels?: string[] }): Promise<void> {
        const m = this.messages(account).get(messageId);
        if (!m) throw new Error(`Message ${messageId} is not in the store for ${account}`);
        if (flags.unread !== undefined) m.unread = flags.unread;
        if (flags.labels !== undefined) m.labels = [...flags.labels];
    }
}

const list = (value: string | null | undefined): string[] => (value ?? '').split(',').map((a) => a.trim()).filter(Boolean);

function toStored(account: string, m: EmailMessage, threadId: string): StoredMessage {
    if (!m.from) throw new Error(`Message ${m.id} has no sender`);
    if (!m.date) throw new Error(`Message ${m.id} has no date`);
    const { text, quotedFrom } = emailText(m);
    return {
        id: m.id,
        threadId,
        from: m.from,
        to: list(m.to),
        cc: list(m.cc),
        subject: m.subject,
        sentAt: new Date(m.date).toISOString(),
        unread: m.unread ?? false,
        labels: m.labels ?? [],
        direction: m.from.toLowerCase().includes(account.toLowerCase()) ? 'outbound' : 'inbound',
        html: m.bodyHtml ? sanitizeEmailHtml(m.bodyHtml) : null,
        text,
        quotedFrom,
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size ?? null })),
    };
}

function required<K extends keyof EmailClient>(client: EmailClient, member: K): NonNullable<EmailClient[K]> {
    const fn = client[member];
    if (typeof fn !== 'function') throw new Error(`The email client does not implement ${String(member)}, which syncing needs`);
    return (fn as (...args: unknown[]) => unknown).bind(client) as NonNullable<EmailClient[K]>;
}

/**
 * Keeps a local copy of one mailbox up to date. `initialImport` copies the
 * newest threads; `syncOnce` applies what changed since. The cursor moves
 * only once every change is applied, so a failure part-way is retried in
 * full next time; applying a message twice updates it rather than copying it.
 */
export class MailSync {
    constructor(private readonly opts: {
        client: EmailClient;
        store: MailStore;
        account: string;
        /** Called once per thread that changed, after the change is stored. */
        onThreadChanged?: (threadId: string) => void | Promise<void>;
    }) {}

    async initialImport(limit: number): Promise<{ threads: number; messages: number }> {
        const { client, store, account } = this.opts;
        // The cursor is taken first, so anything arriving during the import is picked up by the next sync.
        const { cursor } = await required(client, 'changesSince')(null);
        const listThreads = required(client, 'listThreads');
        const getThread = required(client, 'getThread');
        const ids: string[] = [];
        let pageToken: string | null = null;
        do {
            const page = await listThreads({ limit: Math.min(100, limit - ids.length), pageToken });
            ids.push(...page.threads.map((t) => t.id));
            pageToken = page.nextPageToken;
        } while (pageToken !== null && ids.length < limit);
        let messages = 0;
        for (const id of ids) {
            const thread = await getThread(id);
            for (const m of thread.messages) {
                await store.upsertMessage(account, toStored(account, m, thread.id));
                messages++;
            }
        }
        await store.setCursor(account, cursor);
        for (const id of ids) await this.opts.onThreadChanged?.(id);
        return { threads: ids.length, messages };
    }

    async syncOnce(): Promise<{ applied: number; threads: string[] }> {
        const { client, store, account } = this.opts;
        const cursor = await store.getCursor(account);
        if (cursor === null) throw new Error(`No sync cursor for ${account}: run initialImport first`);
        const { changes, cursor: next } = await required(client, 'changesSince')(cursor);
        const getThread = required(client, 'getThread');
        const threads = new Map<string, EmailThreadDetail>();
        const touched = new Set<string>();
        for (const change of changes) {
            touched.add(change.threadId);
            switch (change.kind) {
                case 'message_added': {
                    const thread = threads.get(change.threadId) ?? await getThread(change.threadId);
                    threads.set(change.threadId, thread);
                    const message = thread.messages.find((m) => m.id === change.messageId);
                    // Added and deleted again before this sync: it no longer exists, so the copy must not either.
                    if (!message) await store.deleteMessage(account, change.messageId);
                    else await store.upsertMessage(account, toStored(account, message, thread.id));
                    break;
                }
                case 'message_deleted':
                    await store.deleteMessage(account, change.messageId);
                    break;
                case 'labels_changed':
                    await store.setFlags(account, change.messageId, { labels: change.labels });
                    break;
                case 'read_changed':
                    await store.setFlags(account, change.messageId, { unread: change.unread });
                    break;
            }
        }
        await store.setCursor(account, next);
        for (const id of touched) await this.opts.onThreadChanged?.(id);
        return { applied: changes.length, threads: [...touched] };
    }
}
