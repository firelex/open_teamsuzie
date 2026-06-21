import { describe, expect, it } from 'vitest';
import { OidcClient } from '../utils/oidc-client.js';

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('OidcClient', () => {
    it('includes resource, prompt, and requested scope on authorization URLs', async () => {
        const client = new OidcClient({
            issuer: 'https://issuer.example',
            clientId: 'client',
            clientSecret: 'secret',
            redirectUri: 'https://app.example/callback',
            resource: 'https://tools.example',
            fetchImpl: async () =>
                json({
                    authorization_endpoint: 'https://issuer.example/auth',
                    token_endpoint: 'https://issuer.example/token',
                    userinfo_endpoint: 'https://issuer.example/userinfo',
                }),
        });

        const url = new URL(
            await client.buildAuthorizeUrl({
                state: 'state-1',
                codeChallenge: 'challenge-1',
                scope: 'openid profile email tools offline_access',
                prompt: 'consent',
            }),
        );

        expect(url.searchParams.get('client_id')).toBe('client');
        expect(url.searchParams.get('resource')).toBe('https://tools.example');
        expect(url.searchParams.get('scope')).toBe('openid profile email tools offline_access');
        expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('includes resource on code exchange and refresh token requests', async () => {
        const requests: Array<{ url: string; body: string }> = [];
        const client = new OidcClient({
            issuer: 'https://issuer.example',
            clientId: 'client',
            clientSecret: 'secret',
            redirectUri: 'https://app.example/callback',
            resource: 'https://tools.example',
            fetchImpl: async (input, init) => {
                const url = String(input);
                if (url.endsWith('/.well-known/openid-configuration')) {
                    return json({
                        authorization_endpoint: 'https://issuer.example/auth',
                        token_endpoint: 'https://issuer.example/token',
                        userinfo_endpoint: 'https://issuer.example/userinfo',
                    });
                }
                requests.push({ url, body: String(init?.body ?? '') });
                return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
            },
        });

        await client.exchangeCode({ code: 'code-1', codeVerifier: 'verifier-1' });
        await client.refresh('refresh-1');

        expect(new URLSearchParams(requests[0]?.body).get('resource')).toBe('https://tools.example');
        expect(new URLSearchParams(requests[0]?.body).get('grant_type')).toBe('authorization_code');
        expect(new URLSearchParams(requests[1]?.body).get('resource')).toBe('https://tools.example');
        expect(new URLSearchParams(requests[1]?.body).get('grant_type')).toBe('refresh_token');
    });

    it('posts token revocation when the issuer advertises a revocation endpoint', async () => {
        const requests: string[] = [];
        const client = new OidcClient({
            issuer: 'https://issuer.example',
            clientId: 'client',
            clientSecret: 'secret',
            redirectUri: 'https://app.example/callback',
            fetchImpl: async (input, init) => {
                const url = String(input);
                if (url.endsWith('/.well-known/openid-configuration')) {
                    return json({
                        authorization_endpoint: 'https://issuer.example/auth',
                        token_endpoint: 'https://issuer.example/token',
                        userinfo_endpoint: 'https://issuer.example/userinfo',
                        revocation_endpoint: 'https://issuer.example/revoke',
                    });
                }
                requests.push(String(init?.body ?? ''));
                return json({ ok: true });
            },
        });

        await client.revoke('token-1');

        expect(new URLSearchParams(requests[0]).get('token')).toBe('token-1');
    });
});
