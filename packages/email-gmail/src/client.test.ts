import { describe, expect, it } from 'vitest';
import { EmailCursorExpiredError } from '@teamsuzie/email';
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
