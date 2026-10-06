import { describe, expect, it } from 'vitest';
import { EmailCursorExpiredError, EmailRateLimitError } from '@teamsuzie/email';
import { GmailClient } from './client.js';
import type { GmailApiMessage } from './parse.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
type Handler = (url: URL, body: unknown) => { status?: number; json: unknown };

export function fakeGmail(routes: Record<string, Handler>) {
    const calls: Array<{ method: string; path: string; url: URL; body: unknown; auth: string | null }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        const path = url.pathname.replace('/gmail/v1/users/me', '');
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method, path, url, body, auth: new Headers(init?.headers).get('authorization') });
        const key = Object.keys(routes).find((k) => { const [m, p] = k.split(' '); return m === method && new RegExp(`^${p}$`).test(path); });
        if (!key) return new Response(JSON.stringify({ error: { code: 404, message: `no route ${method} ${path}` } }), { status: 404 });
        const r = routes[key]!(url, body);
        const status = r.status ?? 200;
        // Gmail answers some calls (batchModify) with 204 and no body.
        return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(r.json), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { f, calls };
}

const msg = (id: string, threadId: string, labelIds: string[], subject = 'Hello'): GmailApiMessage => ({
    id, threadId, labelIds, internalDate: String(Date.parse('2026-09-22T08:00:00Z')),
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'anna@x.test' }, { name: 'To', value: 'me@firm.test' }, { name: 'Subject', value: subject }], body: { data: b64('Hi') } },
});
const labels = { labels: [{ id: 'INBOX', name: 'INBOX' }, { id: 'UNREAD', name: 'UNREAD' }, { id: 'Label_7', name: 'Deal/Falcon' }] };
const client = (f: typeof fetch) => new GmailClient({ account: 'me@firm.test', accessToken: async () => 'at-1', fetch: f });

describe('GmailClient reading', () => {
    it('lists threads newest first with their summary, sending the access token', async () => {
        const g = fakeGmail({
            'GET /labels': () => ({ json: labels }),
            'GET /threads': (url) => ({ json: { threads: [{ id: 't1' }], nextPageToken: url.searchParams.get('pageToken') ? undefined : 'p2' } }),
            'GET /threads/t1': () => ({ json: { id: 't1', messages: [msg('m1', 't1', ['INBOX', 'UNREAD', 'Label_7'])] } }),
        });
        const page = await client(g.f).listThreads({ limit: 1 });
        expect(page.nextPageToken).toBe('p2');
        expect(page.threads[0]).toMatchObject({ id: 't1', subject: 'Hello', unread: true, labels: ['INBOX', 'UNREAD', 'Deal/Falcon'], messageIds: ['m1'] });
        expect(g.calls.find((c) => c.path === '/threads')!.url.searchParams.get('maxResults')).toBe('1');
        expect(g.calls.every((c) => c.auth === 'Bearer at-1')).toBe(true);
    });

    it('gets a thread with its messages, label ids turned into names', async () => {
        const g = fakeGmail({ 'GET /labels': () => ({ json: labels }), 'GET /threads/t1': () => ({ json: { id: 't1', messages: [msg('m1', 't1', ['Label_7'])] } }) });
        const t = await client(g.f).getThread('t1');
        expect(t.messages[0]!.labels).toEqual(['Deal/Falcon']);
        expect(g.calls.find((c) => c.path === '/threads/t1')!.url.searchParams.get('format')).toBe('full');
    });

    it('starts sync at the current history id, then reports adds, deletes, label and read changes', async () => {
        const g = fakeGmail({
            'GET /labels': () => ({ json: labels }),
            'GET /profile': () => ({ json: { emailAddress: 'me@firm.test', historyId: '100' } }),
            'GET /history': (url) => url.searchParams.get('pageToken') ? { json: { historyId: '120', history: [
                { id: '111', messagesDeleted: [{ message: { id: 'm0', threadId: 't0' } }] },
            ] } } : { json: { historyId: '120', nextPageToken: 'h2', history: [
                { id: '101', messagesAdded: [{ message: { id: 'm2', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } }] },
                { id: '102', labelsRemoved: [{ message: { id: 'm2', threadId: 't1', labelIds: ['INBOX', 'Label_7'] }, labelIds: ['UNREAD'] }] },
            ] } },
        });
        const c = client(g.f);
        expect(await c.changesSince(null)).toEqual({ changes: [], cursor: '100' });
        const r = await c.changesSince('100');
        expect(r.cursor).toBe('120');
        expect(r.changes).toEqual([
            { kind: 'message_added', threadId: 't1', messageId: 'm2' },
            { kind: 'labels_changed', threadId: 't1', messageId: 'm2', labels: ['INBOX', 'Deal/Falcon'] },
            { kind: 'read_changed', threadId: 't1', messageId: 'm2', unread: false },
            { kind: 'message_deleted', threadId: 't0', messageId: 'm0' },
        ]);
        expect(g.calls.find((x) => x.path === '/history')!.url.searchParams.get('startHistoryId')).toBe('100');
    });

    it('throws EmailRateLimitError when Gmail asks to slow down (a 403 quota answer or a 429), and a plain error for other 403s', async () => {
        const quota = { error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'", errors: [{ reason: 'rateLimitExceeded', domain: 'usageLimits' }] } };
        const slowed = fakeGmail({ 'GET /labels': () => ({ json: labels }), 'GET /threads/t1': () => ({ status: 403, json: quota }) });
        await expect(client(slowed.f).getThread('t1')).rejects.toBeInstanceOf(EmailRateLimitError);
        const busy = fakeGmail({ 'GET /labels': () => ({ json: labels }), 'GET /threads/t1': () => ({ status: 429, json: { error: { code: 429, message: 'Too many concurrent requests for user' } } }) });
        await expect(client(busy.f).getThread('t1')).rejects.toBeInstanceOf(EmailRateLimitError);
        const forbidden = fakeGmail({ 'GET /labels': () => ({ json: labels }), 'GET /threads/t1': () => ({ status: 403, json: { error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } } }) });
        const err = await client(forbidden.f).getThread('t1').catch((e: unknown) => e);
        expect(err).not.toBeInstanceOf(EmailRateLimitError);
        expect(String(err)).toMatch(/insufficient authentication scopes/);
    });

    it('throws EmailCursorExpiredError when Gmail no longer has the history', async () => {
        const g = fakeGmail({ 'GET /labels': () => ({ json: labels }), 'GET /history': () => ({ status: 404, json: { error: { code: 404, message: 'Requested entity was not found.' } } }) });
        await expect(client(g.f).changesSince('5')).rejects.toBeInstanceOf(EmailCursorExpiredError);
    });

    it('marks messages read and unread through the UNREAD label', async () => {
        const g = fakeGmail({ 'POST /messages/batchModify': () => ({ status: 204, json: {} }) });
        await client(g.f).setRead(['m1', 'm2'], true);
        await client(g.f).setRead(['m1'], false);
        expect(g.calls.map((c) => c.body)).toEqual([
            { ids: ['m1', 'm2'], removeLabelIds: ['UNREAD'] },
            { ids: ['m1'], addLabelIds: ['UNREAD'] },
        ]);
    });

    it('applies labels by name, creating a missing one once', async () => {
        let created = 0;
        const g = fakeGmail({
            'GET /labels': () => ({ json: created ? { labels: [...labels.labels, { id: 'Label_9', name: 'Deal/Heron' }] } : labels }),
            'POST /labels': (_u, body) => { created++; return { json: { id: 'Label_9', name: (body as { name: string }).name } }; },
            'POST /threads/t1/modify': () => ({ json: {} }),
        });
        const c = client(g.f);
        await c.modifyLabels('t1', ['Deal/Heron'], ['Deal/Falcon']);
        await c.modifyLabels('t1', ['Deal/Heron'], []);
        expect(created).toBe(1);
        expect(g.calls.filter((x) => x.path === '/threads/t1/modify').map((x) => x.body)).toEqual([
            { addLabelIds: ['Label_9'], removeLabelIds: ['Label_7'] },
            { addLabelIds: ['Label_9'], removeLabelIds: [] },
        ]);
        expect(g.calls.find((x) => x.path === '/labels' && x.method === 'POST')!.body).toMatchObject({ name: 'Deal/Heron', labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    });

    it('opens an attachment as standard base64 with its name and type', async () => {
        const withAtt: GmailApiMessage = { ...msg('m1', 't1', []), payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'a@x.test' }], parts: [
            { mimeType: 'text/plain', body: { data: b64('see') } },
            { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'att-1', size: 3 } },
        ] } };
        const g = fakeGmail({
            'GET /labels': () => ({ json: labels }),
            'GET /messages/m1': () => ({ json: withAtt }),
            'GET /messages/m1/attachments/att-1': () => ({ json: { size: 3, data: Buffer.from([0xfb, 0xff, 0x01]).toString('base64url') } }),
        });
        expect(await client(g.f).openAttachment('m1', 'att-1')).toEqual({ id: 'att-1', filename: 'a.pdf', contentType: 'application/pdf', size: 3, content: Buffer.from([0xfb, 0xff, 0x01]).toString('base64') });
    });

    it('fails loudly on any other Gmail error, naming the call', async () => {
        const g = fakeGmail({ 'GET /threads/t1': () => ({ json: { id: 't1', messages: [msg('m1', 't1', [])] } }), 'GET /labels': () => ({ status: 500, json: { error: { code: 500, message: 'Backend Error' } } }) });
        await expect(client(g.f).getThread('t1')).rejects.toThrow(/GET \/labels.*500.*Backend Error/);
    });
});

const rawOf = (body: unknown) => Buffer.from((body as { raw: string }).raw, 'base64url').toString('utf8');
const original: GmailApiMessage = {
    id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: String(Date.parse('2026-09-22T08:00:00Z')),
    payload: { mimeType: 'multipart/mixed', headers: [
        { name: 'From', value: '"Anna Reed" <anna@x.test>' }, { name: 'To', value: 'me@firm.test, carl@x.test' }, { name: 'Cc', value: 'dora@x.test' },
        { name: 'Subject', value: 'Re: SPA mark-up' }, { name: 'Message-ID', value: '<m1@x.test>' }, { name: 'References', value: '<m0@x.test>' },
    ], parts: [
        { mimeType: 'text/plain', body: { data: b64('Please see attached.') } },
        { mimeType: 'application/pdf', filename: 'SPA.pdf', body: { attachmentId: 'att-1', size: 3 } },
    ] },
};

describe('GmailClient writing', () => {
    const routes = (sent: unknown[]) => ({
        'GET /labels': () => ({ json: labels }),
        'GET /messages/m1': () => ({ json: original }),
        'GET /messages/m1/attachments/att-1': () => ({ json: { size: 3, data: 'JVBE' } }),
        'POST /messages/send': (_u: URL, body: unknown) => { sent.push(body); return { json: { id: 'new-1', threadId: (body as { threadId?: string }).threadId ?? 'tnew' } }; },
        'POST /drafts': (_u: URL, body: unknown) => { sent.push(body); return { json: { id: 'd-1' } }; },
    });

    it('sends a new message and reports the Gmail id', async () => {
        const sent: unknown[] = [];
        const r = await client(fakeGmail(routes(sent)).f).send({ to: 'anna@x.test', subject: 'Hello', body: 'Hi' });
        expect(r).toMatchObject({ queueId: 'new-1', queued: true, direct: true });
        expect(rawOf(sent[0])).toContain('From: me@firm.test\r\n');
        expect((sent[0] as { threadId?: string }).threadId).toBeUndefined();
    });

    it('replies in the same Gmail thread, to the sender, with threading headers and one "Re:"', async () => {
        const sent: unknown[] = [];
        await client(fakeGmail(routes(sent)).f).reply({ messageId: 'm1', body: 'Thanks' });
        expect((sent[0] as { threadId: string }).threadId).toBe('t1');
        const raw = rawOf(sent[0]);
        expect(raw).toContain('To: "Anna Reed" <anna@x.test>\r\n');
        expect(raw).not.toContain('Cc:');
        expect(raw).toContain('Subject: Re: SPA mark-up\r\n');
        expect(raw).toContain('In-Reply-To: <m1@x.test>\r\n');
        expect(raw).toContain('References: <m0@x.test> <m1@x.test>\r\n');
    });

    it('replies to all: everyone on the message except this mailbox', async () => {
        const sent: unknown[] = [];
        await client(fakeGmail(routes(sent)).f).replyAll({ messageId: 'm1', body: 'Thanks all' });
        const raw = rawOf(sent[0]);
        expect(raw).toContain('To: "Anna Reed" <anna@x.test>, carl@x.test\r\n');
        expect(raw).toContain('Cc: dora@x.test\r\n');
    });

    it('forwards with "Fwd:", the original text quoted, and its attachments', async () => {
        const sent: unknown[] = [];
        await client(fakeGmail(routes(sent)).f).forward({ messageId: 'm1', to: 'erin@y.test', body: 'FYI' });
        const raw = rawOf(sent[0]);
        expect(raw).toContain('Subject: Fwd: SPA mark-up\r\n');
        expect(raw).toContain('filename="SPA.pdf"');
        const text = Buffer.from(raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1]!.split('\r\n--')[0]!.replace(/\r\n/g, ''), 'base64').toString('utf8');
        expect(text).toContain('FYI');
        expect(text).toContain('---------- Forwarded message ----------');
        expect(text).toContain('Please see attached.');
    });

    it('saves a draft in a thread', async () => {
        const sent: unknown[] = [];
        expect(await client(fakeGmail(routes(sent)).f).createDraft({ threadId: 't1', inReplyToId: 'm1', to: 'anna@x.test', subject: 'Re: SPA mark-up', body: 'Draft' })).toEqual({ draftId: 'd-1' });
        expect((sent[0] as { message: { threadId: string } }).message.threadId).toBe('t1');
        expect(Buffer.from((sent[0] as { message: { raw: string } }).message.raw, 'base64url').toString('utf8')).toContain('In-Reply-To: <m1@x.test>');
    });
});

describe('GmailClient review fixes', () => {
    const base = (sent: unknown[], extra: Record<string, Handler> = {}) => fakeGmail({
        'GET /labels': () => ({ json: labels }),
        'GET /messages/m1': () => ({ json: original }),
        'POST /messages/send': (_u: URL, body: unknown) => { sent.push(body); return { json: { id: 'new-1' } }; },
        ...extra,
    });

    it('sends a reply to exactly the recipients and subject the draft showed', async () => {
        const sent: unknown[] = [];
        await client(base(sent).f).reply({ messageId: 'm1', body: 'Thanks', to: 'carl@x.test', cc: 'dora@x.test', subject: 'RE: SPA mark-up' });
        const raw = rawOf(sent[0]);
        expect(raw).toContain('To: carl@x.test\r\n');
        expect(raw).toContain('Cc: dora@x.test\r\n');
        expect(raw).toContain('Subject: RE: SPA mark-up\r\n');
        expect(raw).toContain('In-Reply-To: <m1@x.test>\r\n');
    });

    it('keeps "Last, First" names whole when replying to all', async () => {
        const sent: unknown[] = [];
        const withComma: GmailApiMessage = { ...original, payload: { ...original.payload, headers: original.payload.headers!.map((h) => h.name === 'To' ? { name: 'To', value: '"Müller, Hans" <hans@x.de>, me@firm.test' } : h) } };
        await client(base(sent, { 'GET /messages/m1': () => ({ json: withComma }) }).f).replyAll({ messageId: 'm1', body: 'Thanks all' });
        expect(rawOf(sent[0])).toMatch(/To: "Anna Reed" <anna@x\.test>, =\?UTF-8\?B\?[^?]+\?= <hans@x\.de>\r\n/);
    });

    it('says a thread is gone (EmailNotFoundError), and never treats unsent drafts as mail', async () => {
        const { EmailNotFoundError } = await import('@teamsuzie/email');
        const g = fakeGmail({
            'GET /labels': () => ({ json: { labels: [...labels.labels, { id: 'DRAFT', name: 'DRAFT' }] } }),
            'GET /threads/gone': () => ({ status: 404, json: { error: { code: 404, message: 'Requested entity was not found.' } } }),
            'GET /threads/drafty': () => ({ json: { id: 'drafty', messages: [msg('d1', 'drafty', ['DRAFT'])] } }),
            'GET /threads/mixed': () => ({ json: { id: 'mixed', messages: [msg('m1', 'mixed', ['INBOX']), msg('d2', 'mixed', ['DRAFT'])] } }),
            'GET /history': () => ({ json: { historyId: '9', history: [{ id: '8', messagesAdded: [{ message: { id: 'd3', threadId: 'x', labelIds: ['DRAFT'] } }, { message: { id: 'm4', threadId: 'y', labelIds: ['INBOX'] } }] }] } }),
        });
        const c = client(g.f);
        await expect(c.getThread('gone')).rejects.toBeInstanceOf(EmailNotFoundError);
        await expect(c.getThread('drafty')).rejects.toBeInstanceOf(EmailNotFoundError);
        expect((await c.getThread('mixed')).messages.map((m) => m.id)).toEqual(['m1']);
        expect((await c.changesSince('1')).changes).toEqual([{ kind: 'message_added', threadId: 'y', messageId: 'm4' }]);
    });

    it('looks the label list up again once when it meets a label it has not seen', async () => {
        let loads = 0;
        const g = fakeGmail({
            'GET /labels': () => { loads++; return { json: loads === 1 ? labels : { labels: [...labels.labels, { id: 'Label_new', name: 'Deal/Heron' }] } }; },
            'GET /threads/t1': () => ({ json: { id: 't1', messages: [msg('m1', 't1', ['Label_new'])] } }),
        });
        const c = client(g.f);
        await c.changesSince('1').catch(() => undefined); // loads the list once (history route missing here)
        expect((await c.getThread('t1')).messages[0]!.labels).toEqual(['Deal/Heron']);
        expect(loads).toBe(2);
    });

    it('removes a label without creating it, and matches label names regardless of case', async () => {
        const g = fakeGmail({
            'GET /labels': () => ({ json: { labels: [...labels.labels, { id: 'Label_8', name: 'deal/heron' }] } }),
            'POST /labels': () => ({ status: 409, json: { error: { code: 409, message: 'Label name exists or conflicts' } } }),
            'POST /threads/t1/modify': () => ({ json: {} }),
        });
        await client(g.f).modifyLabels('t1', ['Deal/Heron'], ['Deal/Gone']);
        expect(g.calls.filter((x) => x.method === 'POST' && x.path === '/labels')).toEqual([]);
        expect(g.calls.find((x) => x.path === '/threads/t1/modify')!.body).toEqual({ addLabelIds: ['Label_8'], removeLabelIds: [] });
    });
});
