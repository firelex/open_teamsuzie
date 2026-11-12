import { createHash, randomBytes } from 'node:crypto';

/**
 * Microsoft 365 sign-in and Graph requests as the signed-in user, with the
 * delegated permissions of an app registered in the user's Microsoft Entra
 * tenant. Ported from Jeff Desk (jeff_desk/microsoft.py).
 *
 * Sign-in is the OAuth authorization code flow with PKCE, as a public client
 * (no client secret): the app registration needs the platform "Mobile and
 * desktop applications" (or "Single-page application") with the host's
 * redirect URI. Not the device-code flow: tenants commonly block it with
 * Conditional Access. Microsoft may return a new refresh token on every
 * refresh; the host must store it (`saveRefreshToken`).
 */

export const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';

/** Mail, calendar and Teams chats, read and write (writes still go through the host's approvals). */
export const MICROSOFT_SCOPES: readonly string[] = [
    'offline_access',
    'User.Read',
    'Mail.ReadWrite',
    'Mail.Send',
    'Calendars.ReadWrite',
    'Chat.Read',
];
/** Add to read SharePoint and OneDrive files. */
export const MICROSOFT_FILE_SCOPES: readonly string[] = ['Files.Read.All', 'Sites.Read.All'];

export type GraphErrorCode =
    | 'not_configured'
    | 'needs_login'
    | 'sign_in_failed'
    | 'throttled'
    | 'refused'
    | 'invalid_request'
    | 'not_found'
    | 'unreachable'
    | 'internal_error';

/** A Microsoft 365 failure, with Graph's own message. Nothing is retried silently. */
export class GraphError extends Error {
    override readonly name = 'GraphError';
    constructor(
        readonly code: GraphErrorCode,
        message: string,
        readonly status?: number,
    ) {
        super(message);
    }
}

export interface MicrosoftApp {
    /** Application (client) ID of the app registered in Microsoft Entra. */
    clientId: string;
    /** Directory (tenant) ID, or 'organizations' for any work account. */
    tenantId: string;
}

function checkApp(app: MicrosoftApp): void {
    if (!app.clientId || !app.tenantId) {
        throw new GraphError('not_configured', 'Microsoft 365 is not set up: the Entra application (client) ID and directory (tenant) ID are empty');
    }
}

export function createPkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Microsoft's sign-in page for the user's browser. Keep `state` and the PKCE verifier for `exchangeCode`. */
export function authorizationUrl(opts: {
    app: MicrosoftApp;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scopes?: readonly string[];
    loginHint?: string;
}): string {
    checkApp(opts.app);
    const p = new URLSearchParams({
        client_id: opts.app.clientId,
        response_type: 'code',
        redirect_uri: opts.redirectUri,
        response_mode: 'query',
        scope: (opts.scopes ?? MICROSOFT_SCOPES).join(' '),
        state: opts.state,
        code_challenge: opts.codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
    });
    if (opts.loginHint) p.set('login_hint', opts.loginHint);
    return `${LOGIN}/${encodeURIComponent(opts.app.tenantId)}/oauth2/v2.0/authorize?${p.toString()}`;
}

export interface MicrosoftGrant {
    accessToken: string;
    expiresAt: number;
    refreshToken: string | null;
}

async function tokenRequest(app: MicrosoftApp, form: Record<string, string>, f: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }> {
    checkApp(app);
    let res: Response;
    try {
        res = await f(`${LOGIN}/${encodeURIComponent(app.tenantId)}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: app.clientId, ...form }).toString(),
        });
    } catch (err) {
        throw new GraphError('unreachable', `Microsoft could not be reached (${err instanceof Error ? err.message : String(err)})`);
    }
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
        body = { error_description: text.slice(0, 300) };
    }
    return { status: res.status, body };
}

function grantFrom(body: Record<string, unknown>, now: number): MicrosoftGrant {
    if (typeof body.access_token !== 'string') throw new GraphError('sign_in_failed', 'Microsoft answered without an access token');
    return {
        accessToken: body.access_token,
        // A minute early, so a token is never used as it expires.
        expiresAt: now + (Number(body.expires_in ?? 3600) - 60) * 1000,
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    };
}

/** Exchange the code Microsoft sent back to the redirect URI for tokens. */
export async function exchangeCode(opts: {
    app: MicrosoftApp;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scopes?: readonly string[];
    fetch?: typeof fetch;
    now?: () => number;
}): Promise<MicrosoftGrant & { refreshToken: string }> {
    const { status, body } = await tokenRequest(
        opts.app,
        {
            grant_type: 'authorization_code',
            code: opts.code,
            redirect_uri: opts.redirectUri,
            code_verifier: opts.codeVerifier,
            scope: (opts.scopes ?? MICROSOFT_SCOPES).join(' '),
        },
        opts.fetch ?? fetch,
    );
    if (status !== 200) throw new GraphError('sign_in_failed', `Microsoft refused the sign-in: ${String(body.error_description ?? body.error ?? status)}`, status);
    const grant = grantFrom(body, (opts.now ?? Date.now)());
    if (!grant.refreshToken) throw new GraphError('sign_in_failed', 'Microsoft gave no refresh token: is offline_access among the scopes?');
    return { ...grant, refreshToken: grant.refreshToken };
}

export interface GraphSessionOptions {
    app: MicrosoftApp;
    /** The stored refresh token; throw or return null when the user has not signed in. */
    refreshToken: () => Promise<string | null>;
    /** Store a refresh token Microsoft rotated. */
    saveRefreshToken: (token: string) => Promise<void>;
    scopes?: readonly string[];
    fetch?: typeof fetch;
    now?: () => number;
}

/** Access tokens (refreshed when needed) and Graph requests, for one signed-in user. */
export class GraphSession {
    private access: { token: string; expiresAt: number } | null = null;
    private refreshing: Promise<string> | null = null;
    private readonly f: typeof fetch;
    private readonly now: () => number;

    constructor(private readonly opts: GraphSessionOptions) {
        this.f = opts.fetch ?? fetch;
        this.now = opts.now ?? Date.now;
    }

    async token(): Promise<string> {
        if (this.access && this.now() < this.access.expiresAt) return this.access.token;
        // One refresh at a time: concurrent calls wait for the same one.
        this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
        return this.refreshing;
    }

    private async refresh(): Promise<string> {
        const refreshToken = await this.opts.refreshToken();
        if (!refreshToken) throw new GraphError('needs_login', 'Not signed in to Microsoft 365');
        const { status, body } = await tokenRequest(
            this.opts.app,
            { grant_type: 'refresh_token', refresh_token: refreshToken, scope: (this.opts.scopes ?? MICROSOFT_SCOPES).join(' ') },
            this.f,
        );
        if (status !== 200) {
            throw new GraphError('needs_login', `Microsoft 365 needs a new sign-in: ${String(body.error_description ?? body.error ?? 'refused')}`, status);
        }
        const grant = grantFrom(body, this.now());
        if (grant.refreshToken && grant.refreshToken !== refreshToken) await this.opts.saveRefreshToken(grant.refreshToken);
        this.access = { token: grant.accessToken, expiresAt: grant.expiresAt };
        return grant.accessToken;
    }

    /**
     * One Graph call; its JSON answer, or a GraphError with Graph's message.
     * `path` is relative to v1.0 or a full @odata.nextLink.
     */
    async request<T = Record<string, unknown>>(
        method: string,
        path: string,
        opts: { query?: Record<string, string | number>; body?: unknown; headers?: Record<string, string> } = {},
    ): Promise<T> {
        let url = path.startsWith('https://') ? path : GRAPH + path;
        if (opts.query) {
            const q = Object.entries(opts.query)
                .map(([k, v]) => `${encodeURIComponent(k).replace(/%24/g, '$')}=${encodeURIComponent(String(v))}`)
                .join('&');
            url += (url.includes('?') ? '&' : '?') + q;
        }
        let res: Response;
        try {
            res = await this.f(url, {
                method,
                headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json', ...(opts.headers ?? {}) },
                body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
            });
        } catch (err) {
            if (err instanceof GraphError) throw err;
            throw new GraphError('unreachable', `Microsoft could not be reached (${err instanceof Error ? err.message : String(err)})`);
        }
        const text = await res.text();
        let body: unknown = null;
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = { error: { message: text.slice(0, 300) } };
            }
        }
        const where = `${method} ${path.split('?')[0]}`;
        const message = ((body as { error?: { message?: string } } | null)?.error?.message ?? '').trim();
        if (res.status === 429) throw new GraphError('throttled', 'Microsoft Graph is limiting requests for now (HTTP 429); try again in a minute', 429);
        if (res.status === 401 || res.status === 403) throw new GraphError('refused', `Microsoft Graph refused ${where} (HTTP ${res.status}): ${message}`, res.status);
        if (res.status === 404) throw new GraphError('not_found', `Microsoft Graph found nothing at ${where}: ${message}`, 404);
        if (res.status >= 400) {
            throw new GraphError(res.status === 400 ? 'invalid_request' : 'internal_error', `Microsoft Graph ${where} failed (HTTP ${res.status}): ${message}`, res.status);
        }
        return (body ?? {}) as T;
    }

    /** Every item of a list, following @odata.nextLink, up to `limit`. */
    async all<T>(path: string, opts: { query?: Record<string, string | number>; headers?: Record<string, string>; limit: number }): Promise<T[]> {
        const out: T[] = [];
        let page = await this.request<{ value?: T[]; '@odata.nextLink'?: string }>('GET', path, { query: opts.query, headers: opts.headers });
        for (;;) {
            out.push(...(page.value ?? []));
            if (out.length >= opts.limit || !page['@odata.nextLink']) return out.slice(0, opts.limit);
            page = await this.request('GET', page['@odata.nextLink'], { headers: opts.headers });
        }
    }
}
