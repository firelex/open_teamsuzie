import Provider, { type ClientMetadata, type Configuration } from 'oidc-provider';
import type { Sequelize } from 'sequelize';
import { SequelizeOidcAdapter } from './Adapter.js';
import { loadClientRegistry } from './clients.js';
import { loadJwkSet } from './keys.js';

export interface BuildProviderOptions {
  issuer: string;
  jwkPath: string;
  sequelize: Sequelize;
  env?: NodeJS.ProcessEnv;
}

export async function buildOidcProvider(opts: BuildProviderOptions): Promise<Provider> {
  const env = opts.env ?? process.env;
  const jwks = await loadJwkSet(opts.jwkPath, { autoGenerate: env.NODE_ENV !== 'production' });
  const clients = loadClientRegistry(env);
  const expiredAuthRedirectUrl = resolveExpiredAuthRedirectUrl(env);

  const config: Configuration = {
    adapter: (name) => new SequelizeOidcAdapter(name, opts.sequelize),
    clients: clients as unknown as ClientMetadata[],
    jwks,
    // oidc-provider v9 dropped the `methods` field from `pkce`; S256 is the
    // only supported method and is implicit when `required` returns true.
    pkce: { required: () => true },
    scopes: ['openid', 'profile', 'email', 'tools', 'offline_access'],
    claims: {
      openid: ['sub'],
      profile: ['name'],
      email: ['email'],
      tools: [],
    },
    // Suzie uses the ID token to create its local browser session, so first-
    // party code flows need profile/email claims in the ID token rather than
    // requiring a separate userinfo call with the resource-bound access token.
    conformIdTokenClaims: false,
    features: {
      revocation: { enabled: true },
      devInteractions: { enabled: false },
      resourceIndicators: {
        enabled: true,
        // No defaultResource: browser sign-in flows (admin / js-tools
        // console) don't include a `resource` param and don't need a JWT
        // access token - an opaque token is sufficient for /me. M2M
        // callers that want a JWT must pass an absolute resource URI per
        // RFC 8707 (the `js-tools` identifier alone is invalid). Setting
        // a default of `js-tools` was the cause of `invalid_target`
        // errors during admin sign-in.
        getResourceServerInfo: () => ({
          scope: 'tools',
          audience: 'js-tools',
          accessTokenFormat: 'jwt',
          jwt: { sign: { alg: 'RS256' } },
        }),
      },
    },
    // NOTE: oidc-provider v9 dropped the top-level `formats: { AccessToken: 'jwt' }`
    // shape from its types. JWT access-token format is now opted into per
    // resource server via `resourceIndicators.getResourceServerInfo.accessTokenFormat`
    // above, which already covers the `js-tools` audience.
    ttl: {
      AccessToken: 10 * 60,
      RefreshToken: 30 * 24 * 60 * 60,
      AuthorizationCode: 60,
      IdToken: 10 * 60,
      Interaction: 10 * 60,
      Session: 14 * 24 * 60 * 60,
      Grant: 14 * 24 * 60 * 60,
    },
    findAccount: async (_ctx, sub) => {
      // Look up the user in the existing User table. Imported here to
      // avoid circular deps in the bootstrap path.
      const { User } = await import('@teamsuzie/shared-auth');
      const user = await (User as any).findOne({ where: { id: sub } });
      if (!user) return undefined;
      return {
        accountId: user.id,
        claims: async () => ({
          sub: user.id,
          email: user.email,
          name: user.name ?? '',
        }),
      };
    },
    cookies: {
      keys: [env.OIDC_COOKIE_SECRET ?? 'dev-cookie-secret-rotate-me'],
    },
    interactions: {
      url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}`,
    },
    renderError: async (ctx, out) => {
      if (
        out.error === 'invalid_request'
        && out.error_description === 'authorization request has expired'
        && expiredAuthRedirectUrl
      ) {
        ctx.status = 303;
        ctx.redirect(expiredAuthRedirectUrl);
        return;
      }
      ctx.type = 'html';
      ctx.body = `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Sign-in problem</title>
            <style>
              body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f5; color: #1f2933; }
              main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #dedbd2; border-radius: 8px; padding: 28px; box-shadow: 0 14px 40px rgba(30, 41, 59, 0.10); }
              h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.2; }
              p { margin: 0 0 18px; color: #52606d; line-height: 1.5; }
              a { color: #0f766e; font-weight: 650; }
              dl { margin: 18px 0 0; font-size: 13px; color: #697586; }
              dt { font-weight: 700; }
              dd { margin: 2px 0 10px; overflow-wrap: anywhere; }
            </style>
          </head>
          <body>
            <main>
              <h1>Sign-in could not continue</h1>
              <p>The authorization request is no longer active. Start sign-in again from the app.</p>
              ${formatErrorDetails(out)}
            </main>
          </body>
        </html>`;
    },
  };

  return new Provider(opts.issuer, config);
}

function formatErrorDetails(out: object): string {
  const entries = Object.entries(out)
    .filter(([key]) => key !== 'iss')
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`);
  return entries.length ? `<dl>${entries.join('')}</dl>` : '';
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]!);
}

function resolveExpiredAuthRedirectUrl(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string | undefined {
  if (env.OIDC_EXPIRED_AUTH_REDIRECT_URL) return env.OIDC_EXPIRED_AUTH_REDIRECT_URL;
  const suzieRedirect = env.OIDC_CLIENT_SUZIE_REDIRECT_URIS?.split(',')[0]?.trim();
  if (!suzieRedirect) return undefined;
  try {
    return new URL('/api/auth/login', suzieRedirect).toString();
  } catch {
    return undefined;
  }
}
