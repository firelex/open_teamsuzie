import {
  randomState,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
} from 'openid-client';

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  jwks_uri?: string;
}

export interface OidcTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

export interface CreateOpts {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // OPTIONAL RFC 8707 resource indicator. Leave UNSET for a normal browser
  // sign-in app (the default): it authenticates the user, stores the tokens in
  // its own server-side session, and reads its own `/api/auth/me` — it never
  // presents a resource-bound JWT to a resource server, so it needs no
  // `resource`. apps/auth has NO defaultResource and only knows its own
  // registered resource servers, so sending an unregistered/absolute URI here
  // (e.g. the app's own origin) makes the token exchange fail with
  // `invalid_target: resource indicator is missing, or unknown`. Set this ONLY
  // to an absolute URI apps/auth registers as a resource server, when you
  // genuinely need a resource-bound (audience-scoped) JWT.
  resource?: string;
  fetchImpl?: typeof fetch;
  discoverImpl?: (issuerUrl: string) => Promise<OidcDiscovery>;
}

export class OidcClient {
  private discovery: OidcDiscovery | null = null;
  private discoveryPromise: Promise<OidcDiscovery> | null = null;

  constructor(private opts: CreateOpts) {}

  private async ensureDiscovered(): Promise<OidcDiscovery> {
    if (this.discovery) return this.discovery;
    if (!this.discoveryPromise) {
      const discover = this.opts.discoverImpl ?? defaultDiscover(this.opts.fetchImpl);
      this.discoveryPromise = discover(this.opts.issuerUrl).then((d) => {
        this.discovery = d;
        return d;
      });
    }
    return this.discoveryPromise;
  }

  async buildAuthorizationUrl(_args: { returnTo: string }): Promise<{ url: string; state: string; codeVerifier: string }> {
    const d = await this.ensureDiscovered();
    const state = randomState();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set('client_id', this.opts.clientId);
    u.searchParams.set('redirect_uri', this.opts.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid profile email tools offline_access');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    const resource = this.resourceParam();
    if (resource) u.searchParams.set('resource', resource);
    return { url: u.toString(), state, codeVerifier };
  }

  async exchangeCode(args: { code: string; codeVerifier: string }): Promise<OidcTokenResponse> {
    const resource = this.resourceParam();
    return this.postToken({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: this.opts.redirectUri,
      code_verifier: args.codeVerifier,
      ...(resource ? { resource } : {}),
    });
  }

  async refresh(refreshToken: string): Promise<OidcTokenResponse> {
    const resource = this.resourceParam();
    return this.postToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(resource ? { resource } : {}),
    });
  }

  /** The configured resource indicator, or '' when unset — in which case the
   *  `resource` param is omitted entirely (a plain browser sign-in flow). */
  private resourceParam(): string {
    return this.opts.resource?.trim() ?? '';
  }

  async revoke(token: string): Promise<void> {
    const d = await this.ensureDiscovered();
    if (!d.revocation_endpoint) return;
    const f = this.opts.fetchImpl ?? fetch;
    await f(d.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: this.opts.clientId, client_secret: this.opts.clientSecret }).toString(),
    });
  }

  private async postToken(body: Record<string, string>): Promise<OidcTokenResponse> {
    const d = await this.ensureDiscovered();
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...body,
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`token endpoint ${res.status}: ${text}`);
    return JSON.parse(text) as OidcTokenResponse;
  }
}

function defaultDiscover(fetchImpl?: typeof fetch) {
  return async (issuerUrl: string): Promise<OidcDiscovery> => {
    const f = fetchImpl ?? fetch;
    const url = new URL('/.well-known/openid-configuration', issuerUrl).toString();
    const res = await f(url);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    return res.json() as Promise<OidcDiscovery>;
  };
}
