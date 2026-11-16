import { describe, expect, it } from 'vitest';
import { GraphError, GraphSession, MICROSOFT_CHAT_SEND_SCOPES, MICROSOFT_SCOPES, TeamsChats, missingChatSendScopes, sendChatMessage, teamsHtml } from '../index.js';

const app = { clientId: 'client-1', tenantId: 'tenant-1' };

/** A fake Microsoft: the token endpoint (granting `scope`) and Graph routes by method and exact path, answering as Graph does. */
function fakeGraph(routes: Record<string, (body: unknown, url: string) => Response>, scope = [...MICROSOFT_SCOPES, ...MICROSOFT_CHAT_SEND_SCOPES].join(' ')) {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const f = (async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600, scope }), { status: 200 });
        const method = init?.method ?? 'GET';
        const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
        calls.push({ method, url, body });
        const path = decodeURIComponent(url.replace('https://graph.microsoft.com/v1.0', '').split('?')[0]!);
        const route = routes[`${method} ${path}`];
        return route ? route(body, url) : new Response(JSON.stringify({ error: { code: 'NotFound', message: `no route for ${method} ${path}` } }), { status: 404 });
    }) as unknown as typeof fetch;
    const session = new GraphSession({ app, refreshToken: async () => 'refresh-0', saveRefreshToken: async () => undefined, fetch: f, now: () => 0 });
    return { session, calls };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

describe('teamsHtml', () => {
    it('keeps paragraphs, lists and line breaks, and escapes everything else', () => {
        expect(teamsHtml('Hello <b>Sam</b> & co\nSecond line\n\n- one\n- two\n\nLena')).toBe(
            '<p>Hello &lt;b&gt;Sam&lt;/b&gt; &amp; co<br>Second line</p><ul><li>one</li><li>two</li></ul><p>Lena</p>',
        );
        expect(teamsHtml('Mixed\n- point')).toBe('<p>Mixed<br>• point</p>');
    });
});

describe('sendChatMessage', () => {
    it('posts the text as HTML in the chat and returns the new message', async () => {
        const g = fakeGraph({ 'POST /chats/19:abc@thread.v2/messages': json({ id: 'm-9', webUrl: 'https://teams.microsoft.com/l/message/19:abc/m-9' }, 201) });
        expect(await sendChatMessage(g.session, '19:abc@thread.v2', 'Thanks,\nLegal')).toEqual({ id: 'm-9', webUrl: 'https://teams.microsoft.com/l/message/19:abc/m-9' });
        expect(g.calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/messages');
        expect(g.calls[0]!.body).toEqual({ body: { contentType: 'html', content: '<p>Thanks,<br>Legal</p>' } });
    });

    it('refuses an empty text, and passes on Graph\'s refusal', async () => {
        const g = fakeGraph({ 'POST /chats/c1/messages': json({ error: { code: 'Forbidden', message: 'Missing scope permissions on the request.' } }, 403) });
        await expect(sendChatMessage(g.session, 'c1', '  ')).rejects.toMatchObject({ code: 'invalid_request' });
        const err = await sendChatMessage(g.session, 'c1', 'Hi').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GraphError);
        expect(err).toMatchObject({ code: 'refused', status: 403 });
        expect((err as Error).message).toContain('Missing scope permissions');
    });
});

describe('missingChatSendScopes', () => {
    it('tells a connection made before ChatMessage.Send was asked for', async () => {
        expect(missingChatSendScopes(['https://graph.microsoft.com/ChatMessage.Send', 'Chat.Read'])).toEqual([]);
        const g = fakeGraph({}, MICROSOFT_SCOPES.join(' '));
        expect(missingChatSendScopes(await g.session.grantedScopes())).toEqual(['ChatMessage.Send']);
    });
});

describe('TeamsChats.messages', () => {
    it('reads mentions and the message address, and filters by last change when asked', async () => {
        const g = fakeGraph({
            'GET /me': json({ id: 'me-1' }),
            'GET /me/chats/c1/messages': json({
                value: [
                    {
                        id: 'm2',
                        messageType: 'message',
                        createdDateTime: '2026-11-16T10:00:00Z',
                        from: { user: { id: 'u2', displayName: 'Sam' } },
                        body: { contentType: 'html', content: '<p><at id="0">Lena</at> can you look at this NDA?</p>' },
                        mentions: [{ id: 0, mentionText: 'Lena', mentioned: { user: { id: 'me-1', displayName: 'Lena' } } }],
                        webUrl: 'https://teams.microsoft.com/l/message/c1/m2',
                    },
                ],
            }),
        });
        const [m] = await new TeamsChats(g.session).messages('c1', 20, { modifiedSince: '2026-11-16T09:00:00.000Z' });
        expect(m).toMatchObject({ id: 'm2', senderId: 'u2', fromMe: false, mentions: ['me-1'], webUrl: 'https://teams.microsoft.com/l/message/c1/m2', text: 'Lena can you look at this NDA?' });
        const query = new URL(g.calls.at(-1)!.url).searchParams;
        expect(query.get('$filter')).toBe('lastModifiedDateTime gt 2026-11-16T09:00:00.000Z');
        expect(query.get('$orderby')).toBe('lastModifiedDateTime desc');
    });
});
