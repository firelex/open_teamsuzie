import { describe, expect, it } from 'vitest';
import { SlackApiError, SlackClient, compareTs, escapeText, isoOfTs, mentions, plainText, tsOf } from './client.js';

/** A fetch that records each call (method and form fields) and answers with `reply`, as the Slack Web API answers. */
function fakeSlack(reply: (method: string, form: URLSearchParams) => Response) {
    const calls: Array<{ method: string; form: URLSearchParams; auth: string | null }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = url.pathname.replace('/api/', '');
        const form = new URLSearchParams(String(init?.body));
        calls.push({ method, form, auth: new Headers(init?.headers).get('authorization') });
        return reply(method, form);
    }) as typeof fetch;
    return { slack: new SlackClient({ token: 'xoxb-1', fetch: f }), calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('SlackClient', () => {
    it('reads who the token is with auth.test and the bot token', async () => {
        const s = fakeSlack(() => json({ ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'legal', team_id: 'T1', user_id: 'U0BOT', bot_id: 'B1' }));
        expect(await s.slack.authTest()).toEqual({ teamId: 'T1', team: 'Acme', url: 'https://acme.slack.com/', botUserId: 'U0BOT', botName: 'legal', botId: 'B1' });
        expect(s.calls[0]).toMatchObject({ method: 'auth.test', auth: 'Bearer xoxb-1' });
    });

    it('turns { ok: false } into a SlackApiError naming the method and Slack\'s error', async () => {
        const s = fakeSlack(() => json({ ok: false, error: 'invalid_auth' }));
        const err = await s.slack.authTest().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SlackApiError);
        expect(err).toMatchObject({ method: 'auth.test', code: 'invalid_auth', status: 200, tokenRejected: true, rateLimited: false });
        expect((err as Error).message).toBe('Slack refused auth.test: invalid_auth');

        const scope = fakeSlack(() => json({ ok: false, error: 'missing_scope', needed: 'users:read.email' }));
        await expect(scope.slack.user('U1')).rejects.toMatchObject({ code: 'missing_scope', needed: 'users:read.email' });
    });

    it('turns a 429 into a rate-limit error with Slack\'s Retry-After, and retries nothing', async () => {
        const s = fakeSlack(() => json({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': '30' }));
        await expect(s.slack.history('C1', '1.000000')).rejects.toMatchObject({ method: 'conversations.history', code: 'ratelimited', status: 429, retryAfter: 30, rateLimited: true });
        expect(s.calls).toHaveLength(1);
    });

    it('lists conversations across pages, telling direct messages and channels apart', async () => {
        const s = fakeSlack((_m, form) =>
            form.get('cursor') === 'next'
                ? json({ ok: true, channels: [{ id: 'G1', name: 'legal-private', is_private: true, is_member: true }], response_metadata: { next_cursor: '' } })
                : json({ ok: true, channels: [{ id: 'D1', is_im: true, user: 'U1' }, { id: 'C1', name: 'general', is_member: false }], response_metadata: { next_cursor: 'next' } }),
        );
        expect(await s.slack.conversations(['im', 'public_channel', 'private_channel'])).toEqual([
            { id: 'D1', kind: 'im', name: null, isMember: true, userId: 'U1' },
            { id: 'C1', kind: 'public_channel', name: 'general', isMember: false, userId: null },
            { id: 'G1', kind: 'private_channel', name: 'legal-private', isMember: true, userId: null },
        ]);
        expect(s.calls[0]!.form.get('types')).toBe('im,public_channel,private_channel');
        expect(s.calls[0]!.form.get('exclude_archived')).toBe('true');
    });

    it('reads history after a time stamp oldest first, and a thread without its first message', async () => {
        const s = fakeSlack((method) =>
            method === 'conversations.history'
                ? json({ ok: true, messages: [{ ts: '1700000002.000200', user: 'U1', text: 'second' }, { ts: '1700000001.000100', user: 'U1', text: 'first', thread_ts: '1700000001.000100' }] })
                : json({ ok: true, messages: [{ ts: '1700000001.000100', user: 'U1', text: 'parent' }, { ts: '1700000003.000000', bot_id: 'B1', subtype: 'bot_message', text: 'ack' }] }),
        );
        const h = await s.slack.history('D1', '1700000000.000000');
        expect(h.map((m) => m.text)).toEqual(['first', 'second']);
        expect(h[0]).toEqual({ ts: '1700000001.000100', threadTs: '1700000001.000100', user: 'U1', botId: null, subtype: null, text: 'first' });
        expect(s.calls[0]!.form.get('oldest')).toBe('1700000000.000000');
        const r = await s.slack.replies('D1', '1700000001.000100', '1700000001.000100');
        expect(r).toEqual([{ ts: '1700000003.000000', threadTs: null, user: null, botId: 'B1', subtype: 'bot_message', text: 'ack' }]);
        expect(s.calls[1]!.form.get('ts')).toBe('1700000001.000100');
    });

    it('reads a person, a permalink, and posts escaped text in a thread', async () => {
        const s = fakeSlack((method) => {
            if (method === 'users.info') return json({ ok: true, user: { id: 'U1', name: 'sam', profile: { display_name: '', real_name: 'Sam Sales', email: 'sam@acme.example' } } });
            if (method === 'chat.getPermalink') return json({ ok: true, permalink: 'https://acme.slack.com/archives/D1/p1700000001000100' });
            return json({ ok: true, channel: 'D1', ts: '1700000009.000000' });
        });
        expect(await s.slack.user('U1')).toEqual({ id: 'U1', name: 'Sam Sales', email: 'sam@acme.example', isBot: false });
        expect(await s.slack.permalink('D1', '1700000001.000100')).toBe('https://acme.slack.com/archives/D1/p1700000001000100');
        expect(await s.slack.postMessage('D1', 'A < B & C', '1700000001.000100')).toEqual({ channel: 'D1', ts: '1700000009.000000' });
        const post = s.calls[2]!.form;
        expect(post.get('text')).toBe('A &lt; B &amp; C');
        expect(post.get('thread_ts')).toBe('1700000001.000100');
    });
});

describe('Slack text and time stamps', () => {
    it('finds mentions and reads Slack markup as plain text', () => {
        expect(mentions('<@U0BOT> can you look?', 'U0BOT')).toBe(true);
        expect(mentions('<@U0BOT|legal> hi', 'U0BOT')).toBe(true);
        expect(mentions('<@U0BOTX> hi', 'U0BOT')).toBe(false);
        expect(plainText('<@U0BOT> see <https://x.example/a|the NDA> in <#C1|deals> &amp; <!here> &lt;3', { U0BOT: 'Legal' })).toBe(
            '@Legal see the NDA (https://x.example/a) in #deals & @here <3',
        );
        expect(escapeText('<b>&')).toBe('&lt;b&gt;&amp;');
    });

    it('orders and converts time stamps', () => {
        expect(compareTs('1700000001.000100', '1700000001.000099')).toBeGreaterThan(0);
        expect(compareTs('1700000001.000100', '1700000002.000000')).toBeLessThan(0);
        expect(compareTs('1700000001.000100', '1700000001.000100')).toBe(0);
        expect(tsOf(new Date('2026-11-16T10:00:00.250Z'))).toBe('1794823200.250000');
        expect(isoOfTs('1794823200.250000')).toBe('2026-11-16T10:00:00.250Z');
    });
});
