/** The firm's Box app ("Custom App" with user authentication in the Box developer console). */
export interface BoxOAuthApp { clientId: string; clientSecret: string }

/** Read all files and folders the user can see in Box, nothing more (BoxFiles). */
export const BOX_READONLY_SCOPE = 'root_readonly';

const AUTH_URL = 'https://account.box.com/api/oauth2/authorize';
const TOKEN_URL = 'https://api.box.com/oauth2/token';
const REVOKE_URL = 'https://api.box.com/oauth2/revoke';

/** Box no longer accepts a refresh token (revoked, already used, or unused for 60 days): the user signs in again. */
export class BoxAuthError extends Error {
    override readonly name = 'BoxAuthError';
}

/**
 * Where to send the user to sign in. Box has no PKCE; the `state` ties the
 * answer to the sign-in. `scopes` narrow what the token may do to some of the
 * scopes the app is configured with: BOX_READONLY_SCOPE unless given.
 */
export function authorizationUrl(opts: { app: BoxOAuthApp; redirectUri: string; state: string; scopes?: readonly string[] }): string {
    const scopes = opts.scopes ?? [BOX_READONLY_SCOPE];
    if (scopes.length === 0) throw new Error('A Box sign-in must ask for at least one scope');
    const p = new URLSearchParams({
        response_type: 'code',
        client_id: opts.app.clientId,
        redirect_uri: opts.redirectUri,
        state: opts.state,
        scope: scopes.join(' '),
    });
    return `${AUTH_URL}?${p.toString()}`;
}

/**
 * A token answer from Box. Box gives a new refresh token with every answer
 * and the one used stops working, so the caller stores `refreshToken` each time.
 */
export interface BoxTokens { accessToken: string; refreshToken: string; expiresAt: Date }

async function postForm(f: typeof fetch, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    if (text) {
        try {
            body = JSON.parse(text) as Record<string, unknown>;
        } catch (err) {
            throw new Error(`Box answered ${res.status} to ${url} with something that is not JSON: ${text.slice(0, 300)}`, { cause: err });
        }
    }
    return { status: res.status, body };
}

function describe(status: number, body: Record<string, unknown>): string {
    return `Box answered ${status}: ${String(body.error ?? 'no error code')}${body.error_description ? ` (${String(body.error_description)})` : ''}`;
}

function tokensOf(body: Record<string, unknown>, what: string): BoxTokens {
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') throw new Error(`Box did not return an access token when ${what}`);
    if (typeof body.refresh_token !== 'string') throw new Error(`Box did not return a refresh token when ${what}, so the connection could not be kept`);
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + body.expires_in * 1000) };
}

/** Exchanges the code Box sent back to the redirect URI for the user's first tokens. */
export async function exchangeCode(opts: { app: BoxOAuthApp; code: string; redirectUri: string; fetch?: typeof fetch }): Promise<BoxTokens> {
    const { status, body } = await postForm(opts.fetch ?? fetch, TOKEN_URL, {
        grant_type: 'authorization_code', code: opts.code, client_id: opts.app.clientId, client_secret: opts.app.clientSecret, redirect_uri: opts.redirectUri,
    });
    if (status !== 200) throw new Error(`Signing in with Box failed. ${describe(status, body)}`);
    return tokensOf(body, 'signing in');
}

/**
 * A new access token from a refresh token. Box answers with a new refresh
 * token too, and the one given stops working: store the new one before
 * using the access token. BoxAuthError when Box no longer accepts the
 * refresh token.
 */
export async function refreshAccessToken(opts: { app: BoxOAuthApp; refreshToken: string; fetch?: typeof fetch }): Promise<BoxTokens> {
    const { status, body } = await postForm(opts.fetch ?? fetch, TOKEN_URL, {
        grant_type: 'refresh_token', refresh_token: opts.refreshToken, client_id: opts.app.clientId, client_secret: opts.app.clientSecret,
    });
    if (status === 400 && body.error === 'invalid_grant') throw new BoxAuthError(`Box no longer accepts this connection. Reconnect in Settings. (${String(body.error_description ?? 'invalid_grant')})`);
    if (status !== 200) throw new Error(`Refreshing the Box access token failed. ${describe(status, body)}`);
    return tokensOf(body, 'refreshing the access token');
}

/**
 * Revokes a refresh or access token, which ends both. Box answers
 * `invalid_token` or `invalid_grant` for a token it no longer knows (already
 * revoked or expired); that is the state revoking aims for, so it counts as
 * done. Any other failure is thrown.
 */
export async function revokeToken(opts: { app: BoxOAuthApp; token: string; fetch?: typeof fetch }): Promise<void> {
    const { status, body } = await postForm(opts.fetch ?? fetch, REVOKE_URL, { client_id: opts.app.clientId, client_secret: opts.app.clientSecret, token: opts.token });
    if (status === 200) return;
    if (status === 400 && (body.error === 'invalid_token' || body.error === 'invalid_grant')) return;
    throw new Error(`Revoking the Box connection failed. ${describe(status, body)}`);
}
