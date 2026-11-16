import { describe, expect, it } from 'vitest';
import { BoxAuthError, authorizationUrl, exchangeCode, refreshAccessToken, revokeToken } from './auth.js';

const app = { clientId: 'box-client-id', clientSecret: 'box-client-secret' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that records each form posted and answers with `reply`, as Box's OAuth endpoints answer. */
function fakeBox(reply: (url: string, form: URLSearchParams) => Response) {
    const calls: Array<{ url: string; form: URLSearchParams }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const form = new URLSearchParams(String(init?.body ?? ''));
        calls.push({ url, form });
        return reply(url, form);
    }) as typeof fetch;
    return { f, calls };
}

describe('Box sign-in', () => {
    it('sends the user to Box asking for read-only access, with the state and redirect URI', () => {
        const url = new URL(authorizationUrl({ app, redirectUri: 'https://box.firm.test/api/box/callback', state: 's-1' }));
        expect(url.origin + url.pathname).toBe('https://account.box.com/api/oauth2/authorize');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            response_type: 'code', client_id: 'box-client-id', redirect_uri: 'https://box.firm.test/api/box/callback', state: 's-1', scope: 'root_readonly',
        });
        expect(() => authorizationUrl({ app, redirectUri: 'x', state: 's', scopes: [] })).toThrow(/at least one scope/);
    });

    it('exchanges the code for tokens with the app\'s ID and secret', async () => {
        const box = fakeBox(() => json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'bearer', restricted_to: [] }));
        const tokens = await exchangeCode({ app, code: 'c-1', redirectUri: 'https://box.firm.test/api/box/callback', fetch: box.f });
        expect(tokens).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1' });
        expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500_000);
        expect(box.calls[0]!.url).toBe('https://api.box.com/oauth2/token');
        expect(Object.fromEntries(box.calls[0]!.form)).toEqual({
            grant_type: 'authorization_code', code: 'c-1', client_id: 'box-client-id', client_secret: 'box-client-secret', redirect_uri: 'https://box.firm.test/api/box/callback',
        });
    });

    it('fails with Box\'s own words when the code is refused, and when no refresh token comes back', async () => {
        await expect(exchangeCode({ app, code: 'c', redirectUri: 'r', fetch: fakeBox(() => json({ error: 'invalid_grant', error_description: 'Auth code expired' }, 400)).f }))
            .rejects.toThrow('Signing in with Box failed. Box answered 400: invalid_grant (Auth code expired)');
        await expect(exchangeCode({ app, code: 'c', redirectUri: 'r', fetch: fakeBox(() => json({ access_token: 'at', expires_in: 3600 })).f }))
            .rejects.toThrow(/did not return a refresh token/);
    });
});

describe('Box token refresh', () => {
    it('returns the new access token and the new refresh token Box rotates to', async () => {
        const box = fakeBox(() => json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }));
        expect(await refreshAccessToken({ app, refreshToken: 'rt-1', fetch: box.f })).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
        expect(Object.fromEntries(box.calls[0]!.form)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'box-client-id', client_secret: 'box-client-secret' });
    });

    it('is BoxAuthError when Box no longer accepts the refresh token, and a plain error otherwise', async () => {
        await expect(refreshAccessToken({ app, refreshToken: 'rt', fetch: fakeBox(() => json({ error: 'invalid_grant', error_description: 'Refresh token has expired' }, 400)).f }))
            .rejects.toBeInstanceOf(BoxAuthError);
        const other = refreshAccessToken({ app, refreshToken: 'rt', fetch: fakeBox(() => json({ error: 'server_error' }, 500)).f });
        await expect(other).rejects.toThrow('Refreshing the Box access token failed. Box answered 500: server_error');
        await expect(other).rejects.not.toBeInstanceOf(BoxAuthError);
    });
});

describe('Box revocation', () => {
    it('revokes the token with the app\'s ID and secret, and counts a token Box no longer knows as revoked', async () => {
        const box = fakeBox(() => new Response('', { status: 200 }));
        await revokeToken({ app, token: 'rt-1', fetch: box.f });
        expect(box.calls[0]!.url).toBe('https://api.box.com/oauth2/revoke');
        expect(Object.fromEntries(box.calls[0]!.form)).toEqual({ client_id: 'box-client-id', client_secret: 'box-client-secret', token: 'rt-1' });
        await revokeToken({ app, token: 'gone', fetch: fakeBox(() => json({ error: 'invalid_token' }, 400)).f });
    });

    it('throws any other failure', async () => {
        await expect(revokeToken({ app, token: 'rt', fetch: fakeBox(() => json({ error: 'temporarily_unavailable' }, 503)).f }))
            .rejects.toThrow('Revoking the Box connection failed. Box answered 503: temporarily_unavailable');
    });
});
