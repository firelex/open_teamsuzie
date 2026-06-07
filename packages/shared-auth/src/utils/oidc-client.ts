import crypto from 'node:crypto';

export interface OidcClientConfig {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

interface OidcDiscovery {
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
}

export interface OidcUserInfo {
    sub: string;
    email?: string;
    name?: string;
}

export interface OidcTokens {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
}

function base64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class OidcClient {
    private discoveryPromise: Promise<OidcDiscovery> | null = null;

    constructor(private readonly config: OidcClientConfig) {}

    static generatePkce(): { verifier: string; challenge: string } {
        const verifier = base64url(crypto.randomBytes(32));
        const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
        return { verifier, challenge };
    }

    static generateState(): string {
        return base64url(crypto.randomBytes(16));
    }

    private async discover(): Promise<OidcDiscovery> {
        if (this.discoveryPromise) return this.discoveryPromise;
        const url = new URL('/.well-known/openid-configuration', this.config.issuer).toString();
        this.discoveryPromise = fetch(url)
            .then(async (res) => {
                if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} at ${url}`);
                return res.json() as Promise<OidcDiscovery>;
            })
            .catch((err) => {
                // Reset so the next attempt re-fetches instead of caching the rejection.
                this.discoveryPromise = null;
                throw err;
            });
        return this.discoveryPromise;
    }

    async buildAuthorizeUrl(args: { state: string; codeChallenge: string; scope?: string }): Promise<string> {
        const { authorization_endpoint } = await this.discover();
        const url = new URL(authorization_endpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', this.config.clientId);
        url.searchParams.set('redirect_uri', this.config.redirectUri);
        url.searchParams.set('scope', args.scope ?? 'openid profile email');
        url.searchParams.set('state', args.state);
        url.searchParams.set('code_challenge', args.codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        return url.toString();
    }

    async exchangeCode(args: { code: string; codeVerifier: string }): Promise<OidcTokens> {
        const { token_endpoint } = await this.discover();
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: args.code,
            redirect_uri: this.config.redirectUri,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code_verifier: args.codeVerifier,
        });
        const res = await fetch(token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Token exchange failed (${res.status}): ${txt}`);
        }
        return res.json() as Promise<OidcTokens>;
    }

    async fetchUserInfo(accessToken: string): Promise<OidcUserInfo> {
        const { userinfo_endpoint } = await this.discover();
        const res = await fetch(userinfo_endpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Userinfo fetch failed (${res.status}): ${txt}`);
        }
        return res.json() as Promise<OidcUserInfo>;
    }
}
