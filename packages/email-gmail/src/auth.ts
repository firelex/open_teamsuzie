import { createHash, randomBytes } from 'node:crypto';
import { EmailAuthError } from '@teamsuzie/email';

export interface GoogleOAuthClient { clientId: string; clientSecret: string }

/** Read and modify mail, send mail, and learn the address signed in with. */
export const GMAIL_SCOPES: readonly string[] = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'openid',
    'email',
];

/** Google reports some scopes under other names in its token response ("email" as its userinfo URL). */
const GRANTED_AS: Record<string, string[]> = { email: ['email', 'https://www.googleapis.com/auth/userinfo.email'] };

/** The scopes in GMAIL_SCOPES that a grant's scope list does not include, reading Google's own names. */
export function missingScopes(granted: string[]): string[] {
    return GMAIL_SCOPES.filter((s) => !(GRANTED_AS[s] ?? [s]).some((name) => granted.includes(name)));
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** The client from a Google Cloud OAuth client file ("Desktop app" files have `installed`, "Web application" files `web`). */
export function readOAuthClient(json: unknown): GoogleOAuthClient {
    const o = json as { installed?: { client_id?: string; client_secret?: string }; web?: { client_id?: string; client_secret?: string } };
    const c = o?.installed ?? o?.web;
    if (!c?.client_id || !c.client_secret) throw new Error('The Google OAuth client file must have an "installed" or "web" entry with client_id and client_secret');
    return { clientId: c.client_id, clientSecret: c.client_secret };
}

export function createPkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Where to send the user to sign in. `prompt=consent` makes Google return a refresh token every time. */
export function authorizationUrl(opts: { client: GoogleOAuthClient; redirectUri: string; state: string; codeChallenge: string; loginHint?: string }): string {
    const p = new URLSearchParams({
        client_id: opts.client.clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state: opts.state,
        code_challenge: opts.codeChallenge,
        code_challenge_method: 'S256',
    });
    if (opts.loginHint) p.set('login_hint', opts.loginHint);
    return `${AUTH_URL}?${p.toString()}`;
}

export interface GoogleGrant { refreshToken: string; accessToken: string; expiresAt: Date; scopes: string[]; email: string }

async function postForm(f: typeof fetch, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

function describe(status: number, body: Record<string, unknown>): string {
    return `Google answered ${status}: ${String(body.error ?? 'no error code')}${body.error_description ? ` (${String(body.error_description)})` : ''}`;
}

export async function exchangeCode(opts: { client: GoogleOAuthClient; code: string; codeVerifier: string; redirectUri: string; fetch?: typeof fetch }): Promise<GoogleGrant> {
    const { status, body } = await postForm(opts.fetch ?? fetch, TOKEN_URL, {
        grant_type: 'authorization_code', code: opts.code, code_verifier: opts.codeVerifier,
        client_id: opts.client.clientId, client_secret: opts.client.clientSecret, redirect_uri: opts.redirectUri,
    });
    if (status !== 200) throw new Error(`Signing in with Google failed. ${describe(status, body)}`);
    if (typeof body.refresh_token !== 'string') throw new Error('Google did not return a refresh token, so the mailbox could not stay connected');
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') throw new Error('Google did not return an access token');
    if (typeof body.id_token !== 'string') throw new Error('Google did not say which address signed in');
    // The ID token came straight from Google's token endpoint over TLS, so its claims are read without checking the signature.
    const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string; email_verified?: boolean };
    if (!claims.email || claims.email_verified !== true) throw new Error('Google did not confirm a verified email address for this sign-in');
    return {
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        expiresAt: new Date(Date.now() + body.expires_in * 1000),
        scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
        email: claims.email.toLowerCase(),
    };
}

export async function refreshAccessToken(opts: { client: GoogleOAuthClient; refreshToken: string; fetch?: typeof fetch }): Promise<{ accessToken: string; expiresAt: Date }> {
    const { status, body } = await postForm(opts.fetch ?? fetch, TOKEN_URL, {
        grant_type: 'refresh_token', refresh_token: opts.refreshToken, client_id: opts.client.clientId, client_secret: opts.client.clientSecret,
    });
    if (status === 400 && body.error === 'invalid_grant') throw new EmailAuthError(`Google no longer accepts this connection. Reconnect in Settings. (${String(body.error_description ?? 'invalid_grant')})`);
    if (status !== 200 || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') throw new Error(`Refreshing the Google access token failed. ${describe(status, body)}`);
    return { accessToken: body.access_token, expiresAt: new Date(Date.now() + body.expires_in * 1000) };
}

/**
 * Revokes a refresh or access token. Google answers `invalid_token` for a token
 * it has already revoked or expired; that is the state revoking aims for, so it
 * counts as done. Any other failure is thrown.
 */
export async function revokeToken(opts: { token: string; fetch?: typeof fetch }): Promise<void> {
    const { status, body } = await postForm(opts.fetch ?? fetch, REVOKE_URL, { token: opts.token });
    if (status === 200) return;
    if (status === 400 && body.error === 'invalid_token') return;
    throw new Error(`Revoking the Google connection failed. ${describe(status, body)}`);
}
