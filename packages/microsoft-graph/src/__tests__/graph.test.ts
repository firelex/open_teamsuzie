import { describe, expect, it } from 'vitest';
import { EmailAuthError, EmailNotFoundError, EmailRateLimitError } from '@teamsuzie/email';
import { GraphError, GraphSession, OutlookCalendar, OutlookMailClient, TeamsChats, authorizationUrl, exchangeCode } from '../index.js';

const app = { clientId: 'client-1', tenantId: 'tenant-1' };

interface Call {
    method: string;
    url: string;
    body: string | undefined;
    headers: Record<string, string>;
}

/** A fake Microsoft: token endpoint plus Graph routes matched by method and path prefix. */
function fakeMicrosoft(routes: Array<[string, string, (call: Call) => [number, unknown]]>) {
    const calls: Call[] = [];
    let tokenCount = 0;
    const f = (async (input: string, init?: RequestInit) => {
        const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body as string | undefined, headers: (init?.headers ?? {}) as Record<string, string> };
        calls.push(call);
        if (call.url.includes('/oauth2/v2.0/token')) {
            tokenCount++;
            const form = new URLSearchParams(call.body ?? '');
            if (form.get('refresh_token') === 'revoked') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS70000: revoked' }), { status: 400 });
            return new Response(JSON.stringify({ access_token: `access-${tokenCount}`, expires_in: 3600, refresh_token: `refresh-${tokenCount}` }), { status: 200 });
        }
        const path = call.url.replace('https://graph.microsoft.com/v1.0', '');
        for (const [method, prefix, answer] of routes) {
            if (method === call.method && path.startsWith(prefix)) {
                const [status, body] = answer(call);
                return new Response(body === undefined ? '' : JSON.stringify(body), { status });
            }
        }
        return new Response(JSON.stringify({ error: { message: `no route for ${call.method} ${path}` } }), { status: 404 });
    }) as unknown as typeof fetch;
    return { f, calls };
}

function session(f: typeof fetch, token: string | null = 'refresh-0') {
    const saved: string[] = [];
    let now = 0;
    const s = new GraphSession({
        app,
        refreshToken: async () => token,
        saveRefreshToken: async (t) => void saved.push(t),
        fetch: f,
        now: () => now,
    });
    return { s, saved, advance: (ms: number) => (now += ms) };
}

describe('sign-in', () => {
    it('builds the PKCE authorization URL and exchanges the code', async () => {
        const url = new URL(authorizationUrl({ app, redirectUri: 'http://localhost/api/microsoft/callback', state: 'st', codeChallenge: 'ch' }));
        expect(url.pathname).toBe('/tenant-1/oauth2/v2.0/authorize');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')).toContain('offline_access');
        const { f, calls } = fakeMicrosoft([]);
        const grant = await exchangeCode({ app, code: 'c', codeVerifier: 'v', redirectUri: 'r', fetch: f, now: () => 0 });
        expect(grant).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
        expect(new URLSearchParams(calls[0]!.body).get('code_verifier')).toBe('v');
        expect(() => authorizationUrl({ app: { clientId: '', tenantId: '' }, redirectUri: 'r', state: 's', codeChallenge: 'c' })).toThrow(/not set up/);
    });
});

describe('GraphSession', () => {
    it('refreshes once, keeps the rotated refresh token, and reuses the access token until it expires', async () => {
        const { f, calls } = fakeMicrosoft([['GET', '/me', () => [200, { id: 'u1' }]]]);
        const { s, saved, advance } = session(f);
        await Promise.all([s.request('GET', '/me'), s.request('GET', '/me')]);
        expect(calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
        expect(saved).toEqual(['refresh-1']);
        expect(calls[1]!.headers.authorization).toBe('Bearer access-1');
        advance(3600_000);
        await s.request('GET', '/me');
        expect(calls.filter((c) => c.url.includes('/token'))).toHaveLength(2);
    });

    it('reports a missing or revoked sign-in and Graph errors with their message', async () => {
        const { f } = fakeMicrosoft([
            ['GET', '/me/throttled', () => [429, {}]],
            ['GET', '/me/denied', () => [403, { error: { message: 'Access is denied.' } }]],
        ]);
        await expect(session(f, null).s.request('GET', '/me')).rejects.toMatchObject({ code: 'needs_login' });
        await expect(session(f, 'revoked').s.request('GET', '/me')).rejects.toThrow(/new sign-in: AADSTS70000/);
        const { s } = session(f);
        await expect(s.request('GET', '/me/throttled')).rejects.toMatchObject({ code: 'throttled' });
        await expect(s.request('GET', '/me/denied')).rejects.toThrow(/refused GET \/me\/denied \(HTTP 403\): Access is denied/);
        await expect(s.request('GET', '/nowhere')).rejects.toBeInstanceOf(GraphError);
    });

    it('follows next links up to the limit and encodes $ parameters', async () => {
        const { f, calls } = fakeMicrosoft([
            ['GET', '/me/things?', () => [200, { value: [1, 2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/things2' }]],
            ['GET', '/me/things2', () => [200, { value: [3, 4] }]],
        ]);
        const { s } = session(f);
        expect(await s.all('/me/things', { query: { $filter: "a eq 'b c'" }, limit: 3 })).toEqual([1, 2, 3]);
        expect(calls[1]!.url).toContain("$filter=a%20eq%20'b%20c'");
    });
});

const message = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    conversationId: 'conv-1',
    subject: 'Side letter',
    from: { emailAddress: { name: 'Tom Widget', address: 'tom@widget.com' } },
    toRecipients: [{ emailAddress: { name: 'Jane', address: 'jane@firm.test' } }],
    ccRecipients: [],
    receivedDateTime: '2026-11-12T09:00:00Z',
    bodyPreview: 'Please see attached',
    isRead: false,
    ...extra,
});

describe('OutlookMailClient', () => {
    it('lists, reads, threads and finds mail between times with its people', async () => {
        const { f, calls } = fakeMicrosoft([
            ['GET', '/me/mailFolders/inbox/messages', () => [200, { value: [message('m1')] }]],
            ['GET', '/me/mailFolders/sentitems/messages', () => [200, { value: [message('s1', { sentDateTime: '2026-11-12T10:00:00Z', receivedDateTime: undefined })] }]],
            ['GET', '/me/messages/m1', () => [200, { ...message('m1'), body: { contentType: 'text', content: 'Hello' } }]],
            ['GET', '/me/messages?', () => [200, { value: [message('m2', { receivedDateTime: '2026-11-12T11:00:00Z' }), message('m1')] }]],
        ]);
        const mail = new OutlookMailClient(session(f).s, 'jane@firm.test');
        expect((await mail.listMessages()).messages[0]).toMatchObject({ id: 'm1', from: 'tom@widget.com', unread: true, threadId: 'conv-1' });
        expect(await mail.getMessage('m1')).toMatchObject({ bodyText: 'Hello' });
        const thread = await mail.getThread("conv'1");
        expect(thread.messageIds).toEqual(['m1', 'm2']);
        expect(calls.at(-1)!.url).toContain("conversationId%20eq%20'conv''1'");
        const sent = await mail.between('sentitems', '2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z');
        expect(sent[0]!.people).toEqual([
            { name: 'Tom Widget', address: 'tom@widget.com', role: 'from' },
            { name: 'Jane', address: 'jane@firm.test', role: 'to' },
        ]);
        expect(calls.at(-1)!.url).toContain('sentDateTime%20ge%202026-11-12T00%3A00%3A00Z');
    });

    it('sends, replies and forwards in Graph form, and maps errors to the email package', async () => {
        const { f, calls } = fakeMicrosoft([
            ['POST', '/me/sendMail', () => [202, undefined]],
            ['POST', '/me/messages/m1/reply', () => [202, undefined]],
            ['POST', '/me/messages/m1/forward', () => [202, undefined]],
            ['GET', '/me/messages/gone', () => [404, { error: { message: 'not found' } }]],
            ['GET', '/me/mailFolders/inbox/messages', () => [429, {}]],
        ]);
        const mail = new OutlookMailClient(session(f).s, 'jane@firm.test');
        await mail.send({ to: 'a@x.test, b@x.test', subject: 'Hi', body: 'Text', cc: 'c@x.test' });
        expect(JSON.parse(calls.at(-1)!.body!).message).toMatchObject({
            toRecipients: [{ emailAddress: { address: 'a@x.test' } }, { emailAddress: { address: 'b@x.test' } }],
            ccRecipients: [{ emailAddress: { address: 'c@x.test' } }],
            body: { contentType: 'Text', content: 'Text' },
        });
        await mail.reply({ messageId: 'm1', body: 'Thanks' });
        expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ comment: 'Thanks' });
        await mail.forward({ messageId: 'm1', to: 'd@x.test', body: 'FYI' });
        expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ comment: 'FYI', toRecipients: [{ emailAddress: { address: 'd@x.test' } }] });
        await expect(mail.getMessage('gone')).rejects.toBeInstanceOf(EmailNotFoundError);
        await expect(mail.listMessages()).rejects.toBeInstanceOf(EmailRateLimitError);
        expect(mail.status().reachable).toBe(false);
        const signedOut = new OutlookMailClient(session(f, null).s, 'jane@firm.test');
        await expect(signedOut.probe()).rejects.toBeInstanceOf(EmailAuthError);
    });
});

describe('calendar and Teams', () => {
    it('reads events in UTC and chat messages as text, marking the user’s own', async () => {
        const { f, calls } = fakeMicrosoft([
            [
                'GET',
                '/me/calendarView',
                () => [
                    200,
                    {
                        value: [
                            {
                                id: 'e1',
                                subject: 'Call with Widget',
                                start: { dateTime: '2026-11-12T14:00:00.0000000' },
                                end: { dateTime: '2026-11-12T14:30:00.0000000' },
                                responseStatus: { response: 'accepted' },
                                attendees: [{ type: 'required', status: { response: 'accepted' }, emailAddress: { name: 'Tom', address: 'tom@widget.com' } }],
                                organizer: { emailAddress: { address: 'jane@firm.test' } },
                            },
                        ],
                    },
                ],
            ],
            ['GET', '/me?', () => [200, { id: 'me-1' }]],
            [
                'GET',
                '/me/chats/chat%3A1/messages',
                () => [
                    200,
                    {
                        value: [
                            { id: 'x2', messageType: 'message', createdDateTime: '2026-11-12T10:05:00Z', from: { user: { id: 'me-1', displayName: 'Jane' } }, body: { contentType: 'html', content: '<p>Will send the draft&nbsp;today</p>' } },
                            { id: 'x1', messageType: 'message', createdDateTime: '2026-11-12T10:00:00Z', from: { user: { id: 'u2', displayName: 'Tom' } }, body: { contentType: 'text', content: 'Any news?' }, attachments: [{ name: 'terms.pdf' }] },
                            { id: 'sys', messageType: 'systemEventMessage', createdDateTime: '2026-11-12T09:00:00Z' },
                        ],
                    },
                ],
            ],
        ]);
        const { s } = session(f);
        const [event] = await new OutlookCalendar(s).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z');
        expect(event).toMatchObject({ start: '2026-11-12T14:00:00Z', end: '2026-11-12T14:30:00Z', response: 'accepted', attendees: [{ address: 'tom@widget.com' }] });
        expect(calls.find((c) => c.url.includes('calendarView'))!.headers.prefer).toBe('outlook.timezone="UTC"');
        const msgs = await new TeamsChats(s).messages('chat:1');
        expect(msgs.map((m) => [m.id, m.fromMe, m.text])).toEqual([
            ['x1', false, 'Any news?\n[file: terms.pdf]'],
            ['x2', true, 'Will send the draft today'],
        ]);
    });
});
