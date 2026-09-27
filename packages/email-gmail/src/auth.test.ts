import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EmailAuthError } from '@teamsuzie/email';
import { authorizationUrl, createPkce, exchangeCode, GMAIL_SCOPES, readOAuthClient, refreshAccessToken, revokeToken } from './auth.js';

const client = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'secret' };
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
/** A fetch that records each call and answers with `reply`. */
function fakeFetch(reply: (url: string, body: URLSearchParams) => { status: number; json: unknown }) {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const f = (async (url: string | URL, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body ?? ''));
        calls.push({ url: String(url), body });
        const r = reply(String(url), body);
        return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { f, calls };
}

describe('Google sign-in', () => {
    it('reads a desktop or web OAuth client file and refuses anything else', () => {
        expect(readOAuthClient({ installed: { client_id: 'a', client_secret: 'b' } })).toEqual({ clientId: 'a', clientSecret: 'b' });
        expect(readOAuthClient({ web: { client_id: 'a', client_secret: 'b' } })).toEqual({ clientId: 'a', clientSecret: 'b' });
        expect(() => readOAuthClient({ other: {} })).toThrow(/installed.*web/);
    });

    it('makes a PKCE pair whose challenge is the SHA-256 of the verifier', () => {
        const { verifier, challenge } = createPkce();
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    });

    it('asks for offline access, consent, PKCE and exactly the four scopes', () => {
        const url = new URL(authorizationUrl({ client, redirectUri: 'http://localhost:5611/api/mail/google/callback', state: 's1', codeChallenge: 'c1', loginHint: 'me@firm.test' }));
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: client.clientId, redirect_uri: 'http://localhost:5611/api/mail/google/callback', response_type: 'code',
            scope: GMAIL_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: 's1',
            code_challenge: 'c1', code_challenge_method: 'S256', login_hint: 'me@firm.test',
        });
        expect(GMAIL_SCOPES).toEqual(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'openid', 'email']);
    });

    it('exchanges a code for a grant with the address Google confirms', async () => {
        const { f, calls } = fakeFetch(() => ({ status: 200, json: {
            access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: GMAIL_SCOPES.join(' '), id_token: idToken({ email: 'me@firm.test', email_verified: true }),
        } }));
        const grant = await exchangeCode({ client, code: 'code1', codeVerifier: 'v1', redirectUri: 'http://localhost/cb', fetch: f });
        expect(grant).toMatchObject({ refreshToken: 'rt', accessToken: 'at', email: 'me@firm.test', scopes: [...GMAIL_SCOPES] });
        expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500_000);
        expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
        expect(Object.fromEntries(calls[0]!.body)).toMatchObject({ grant_type: 'authorization_code', code: 'code1', code_verifier: 'v1', client_id: client.clientId, client_secret: 'secret', redirect_uri: 'http://localhost/cb' });
    });

    it('refuses a grant without a refresh token or a verified address', async () => {
        const noRefresh = fakeFetch(() => ({ status: 200, json: { access_token: 'at', expires_in: 3600, scope: '', id_token: idToken({ email: 'me@firm.test', email_verified: true }) } }));
        await expect(exchangeCode({ client, code: 'c', codeVerifier: 'v', redirectUri: 'r', fetch: noRefresh.f })).rejects.toThrow(/refresh token/);
        const unverified = fakeFetch(() => ({ status: 200, json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: '', id_token: idToken({ email: 'me@firm.test', email_verified: false }) } }));
        await expect(exchangeCode({ client, code: 'c', codeVerifier: 'v', redirectUri: 'r', fetch: unverified.f })).rejects.toThrow(/verified/);
    });

    it('refreshes an access token, and turns invalid_grant into EmailAuthError', async () => {
        const ok = fakeFetch(() => ({ status: 200, json: { access_token: 'at2', expires_in: 3599 } }));
        expect((await refreshAccessToken({ client, refreshToken: 'rt', fetch: ok.f })).accessToken).toBe('at2');
        expect(Object.fromEntries(ok.calls[0]!.body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt' });
        const refused = fakeFetch(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }));
        await expect(refreshAccessToken({ client, refreshToken: 'rt', fetch: refused.f })).rejects.toBeInstanceOf(EmailAuthError);
        const down = fakeFetch(() => ({ status: 503, json: { error: 'backendError' } }));
        const err = await refreshAccessToken({ client, refreshToken: 'rt', fetch: down.f }).catch((e: unknown) => e);
        expect(err).not.toBeInstanceOf(EmailAuthError);
        expect(String(err)).toMatch(/503/);
    });

    it('revokes a token; a token Google already considers invalid counts as revoked', async () => {
        const ok = fakeFetch(() => ({ status: 200, json: {} }));
        await revokeToken({ token: 'rt', fetch: ok.f });
        expect(ok.calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
        expect(ok.calls[0]!.body.get('token')).toBe('rt');
        const gone = fakeFetch(() => ({ status: 400, json: { error: 'invalid_token' } }));
        await revokeToken({ token: 'rt', fetch: gone.f });
        const down = fakeFetch(() => ({ status: 500, json: { error: 'x' } }));
        await expect(revokeToken({ token: 'rt', fetch: down.f })).rejects.toThrow(/500/);
    });
});

describe('granted permissions', () => {
    it('reads Google\'s full scope names, as its token endpoint really returns them', async () => {
        const { missingScopes } = await import('./auth.js');
        const real = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'openid', 'https://www.googleapis.com/auth/userinfo.email'];
        expect(missingScopes(real)).toEqual([]);
        expect(missingScopes(real.filter((s) => !s.endsWith('gmail.send')))).toEqual(['https://www.googleapis.com/auth/gmail.send']);
        expect(missingScopes(['openid'])).toContain('email');
    });
});
