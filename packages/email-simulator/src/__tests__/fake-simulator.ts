/**
 * An in-memory stand-in for the email simulator's native REST API, served as a `fetch` implementation. It keeps the
 * behaviour the client relies on: one id per email shared by every mailbox copy, a `seq` per email shared by every copy,
 * mailbox reads ordered by seq with `after`/`limit` paging, threads (a reply joins its original's thread, a new email
 * starts its own), "RE: " subjects for replies without one, Bcc hidden from inbox copies, and attachments stored as bytes.
 */

interface User { id: string; email: string; display_name: string; department: string }
interface Attachment { id: string; filename: string; content_type: string; content: Buffer }
interface Email {
    seq: number; id: string; kind: 'email'; sender_id: string; conversation_id: null; subject: string; body: string; created: number;
    thread_id: string; in_reply_to: string | null; to: string[]; cc: string[]; bcc: string[]; attachments: Attachment[];
}
interface EmailInput {
    sender_id: string; to: string[]; cc?: string[]; bcc?: string[]; subject?: string | null; body: string; in_reply_to?: string | null;
    attachments?: Array<{ filename: string; content_type: string; content_base64: string }>;
}

class SimError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

const REPLY_PREFIX = /^((re|fw|fwd):\s*)+/i;

export class FakeSimulator {
    readonly users: User[] = [];
    readonly emails: Email[] = [];
    /** user id -> email ids per folder. */
    private readonly boxes = new Map<string, { inbox: string[]; sent: string[] }>();
    private seq = 0;
    private ids = 0;
    private clock = 1_792_900_000;
    generation = 1;
    /** Every request the fake answered, as "METHOD /path?query". */
    readonly calls: string[] = [];

    constructor(readonly apiKey: string) {}

    addUser(email: string, displayName = email): User {
        const user = { id: `u-${++this.ids}`, email: email.toLowerCase(), display_name: displayName, department: '' };
        this.users.push(user);
        this.boxes.set(user.id, { inbox: [], sent: [] });
        return user;
    }

    /** Wipes the population, as POST /v1/reset does; seq keeps counting. */
    reset(): void {
        this.users.length = 0;
        this.emails.length = 0;
        this.boxes.clear();
        this.generation++;
    }

    readonly fetch: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const method = (init?.method ?? 'GET').toUpperCase();
        this.calls.push(`${method} ${url.pathname}${url.search}`);
        try {
            const headers = new Headers(init?.headers);
            if (headers.get('authorization') !== `Bearer ${this.apiKey}`) throw new SimError(401, 'Invalid app key');
            const body = init?.body === undefined || init.body === null ? undefined : JSON.parse(String(init.body)) as unknown;
            const { status, json } = this.route(method, url, body);
            return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
        } catch (err) {
            if (!(err instanceof SimError)) throw err;
            return new Response(JSON.stringify({ detail: err.message }), { status: err.status, headers: { 'content-type': 'application/json' } });
        }
    };

    private route(method: string, url: URL, body: unknown): { status: number; json: unknown } {
        const path = url.pathname;
        let m: RegExpExecArray | null;
        if (method === 'GET' && path === '/v1/users') return { status: 200, json: { users: [...this.users].sort((a, b) => a.email.localeCompare(b.email)) } };
        if (method === 'POST' && path === '/v1/emails') return { status: 201, json: this.post(body as EmailInput) };
        if (method === 'GET' && (m = /^\/v1\/emails\/([^/]+)\/attachments\/([^/]+)$/.exec(path))) {
            const email = this.email(m[1]!, 'Email not found in this app');
            const a = email.attachments.find((x) => x.id === m![2]);
            if (!a) throw new SimError(404, 'Attachment not found on this email');
            return { status: 200, json: { id: a.id, filename: a.filename, content_type: a.content_type, size: a.content.length, content_base64: a.content.toString('base64') } };
        }
        if (method === 'GET' && (m = /^\/v1\/emails\/([^/]+)$/.exec(path))) return { status: 200, json: this.view(this.email(m[1]!, 'Message not found in this app'), false) };
        if (method === 'GET' && (m = /^\/v1\/mailboxes\/([^/]+)\/messages$/.exec(path))) {
            const box = this.boxes.get(m[1]!);
            if (!box) throw new SimError(404, 'User not found in this app');
            const folder = url.searchParams.get('folder') ?? 'inbox';
            if (folder !== 'inbox' && folder !== 'sent') throw new SimError(422, `folder ${folder} is not inbox or sent`);
            const after = Number(url.searchParams.get('after') ?? '0');
            const limit = Number(url.searchParams.get('limit') ?? '100');
            if (!(limit >= 1 && limit <= 1000)) throw new SimError(422, 'limit must be 1 to 1000');
            const rows = box[folder].map((id) => this.email(id, 'missing')).filter((e) => e.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
            return { status: 200, json: { messages: rows.map((e) => this.view(e, folder === 'inbox')), next_cursor: rows.length ? rows[rows.length - 1]!.seq : after, generation: this.generation } };
        }
        throw new SimError(404, 'Not Found');
    }

    private post(input: EmailInput): unknown {
        const user = (id: string) => {
            if (!this.boxes.has(id)) throw new SimError(404, 'User not found in this app');
            return id;
        };
        user(input.sender_id);
        if (!Array.isArray(input.to) || input.to.length === 0) throw new SimError(422, 'to must list at least one user');
        if (typeof input.body !== 'string' || input.body.length === 0) throw new SimError(422, 'body must not be empty');
        const cc = input.cc ?? [];
        const bcc = input.bcc ?? [];
        const recipients = new Set([...input.to, ...cc, ...bcc].map(user));
        const id = `e-${++this.ids}`;
        let threadId = id;
        let subject = input.subject ?? null;
        if (input.in_reply_to !== undefined && input.in_reply_to !== null) {
            const original = this.emails.find((e) => e.id === input.in_reply_to);
            if (!original) throw new SimError(404, 'in_reply_to email not found in this app');
            threadId = original.thread_id;
            if (subject === null) subject = 'RE: ' + original.subject.replace(REPLY_PREFIX, '');
        }
        const attachments = (input.attachments ?? []).map((a, i) => {
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.content_base64)) throw new SimError(422, `attachments[${i}].content_base64 is not valid base64`);
            return { id: `a-${++this.ids}`, filename: a.filename, content_type: a.content_type, content: Buffer.from(a.content_base64, 'base64') };
        });
        const email: Email = {
            seq: ++this.seq, id, kind: 'email', sender_id: input.sender_id, conversation_id: null, subject: subject ?? '', body: input.body,
            created: (this.clock += 1.25), thread_id: threadId, in_reply_to: input.in_reply_to ?? null, to: input.to, cc, bcc, attachments,
        };
        this.emails.push(email);
        this.boxes.get(input.sender_id)!.sent.push(id);
        for (const r of recipients) this.boxes.get(r)!.inbox.push(id);
        return this.view(email, false);
    }

    private email(id: string, notFound: string): Email {
        const e = this.emails.find((x) => x.id === id);
        if (!e) throw new SimError(404, notFound);
        return e;
    }

    private view(e: Email, hideBcc: boolean): unknown {
        const { attachments, bcc, ...rest } = e;
        return {
            ...rest,
            ...(hideBcc ? {} : { bcc }),
            attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.content.length })),
        };
    }
}
