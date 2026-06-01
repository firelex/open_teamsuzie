import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { HostedDemoAuthProvider, TokenBudgetStore } from './token-budget.js';

export type OAuthProviderId = 'google' | 'microsoft';

export interface OAuthProviderConfig {
  id: OAuthProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant?: string;
}

export interface OAuthSessionShape {
  oauthState?: { provider: OAuthProviderId; nonce: string };
  user?: { email: string; name: string; role: string };
}

interface OAuthProfile {
  subject: string;
  email: string;
  name: string;
}

export function createOAuthRouter(opts: {
  providers: OAuthProviderConfig[];
  budget: TokenBudgetStore;
  successRedirectPath?: string;
  defaultRole?: string;
  /**
   * Called after a successful OAuth sign-in, before redirecting. Use to
   * bridge the hosted-demo `session.user` into a richer user store
   * (e.g. shared-auth's Postgres `users` table) and to attach additional
   * session fields (e.g. `session.userId`). Throwing aborts the redirect
   * and surfaces a 500 to the user.
   */
  onSignIn?: (ctx: {
    profile: { email: string; name: string; subject: string };
    provider: string;
    session: OAuthSessionShape;
  }) => Promise<void> | void;
}): Router {
  const router: Router = Router();
  const providers = new Map(opts.providers.map((p) => [p.id, p]));

  router.get('/auth/providers', (_req, res) => {
    res.json({
      providers: opts.providers.map((p) => ({
        id: p.id,
        label: p.label,
        startUrl: `/api/auth/${p.id}/start`,
      })),
    });
  });

  router.get('/auth/:provider/start', (req, res) => {
    const provider = providerFromParam(req.params.provider);
    const cfg = provider ? providers.get(provider) : null;
    if (!provider || !cfg) {
      res.status(404).json({ error: 'provider_not_configured' });
      return;
    }

    const session = (req as unknown as { session?: OAuthSessionShape }).session;
    if (!session) {
      res.status(500).json({ error: 'session_not_initialized' });
      return;
    }
    const state = { provider, nonce: randomBytes(24).toString('base64url') };
    session.oauthState = state;
    res.redirect(buildAuthUrl(cfg, state.nonce).toString());
  });

  router.get('/auth/:provider/callback', async (req, res) => {
    const provider = providerFromParam(req.params.provider);
    const cfg = provider ? providers.get(provider) : null;
    const session = (req as unknown as { session?: OAuthSessionShape }).session;
    if (!session) {
      res.status(500).send('Session not initialized');
      return;
    }
    const expected = session.oauthState;
    session.oauthState = undefined;

    if (!provider || !cfg || !expected || expected.provider !== provider) {
      res.status(400).send('Invalid OAuth state');
      return;
    }
    if (String(req.query.state || '') !== expected.nonce) {
      res.status(400).send('Invalid OAuth state');
      return;
    }
    const code = String(req.query.code || '');
    if (!code) {
      res.status(400).send('Missing OAuth code');
      return;
    }

    try {
      const profile = await exchangeCodeForProfile(cfg, code);
      const account = opts.budget.upsertAccount({
        email: profile.email,
        name: profile.name,
        role: opts.defaultRole ?? 'user',
        authProvider: provider as HostedDemoAuthProvider,
        authSubject: profile.subject,
      });
      session.user = {
        email: account.email,
        name: account.name,
        role: account.role,
      };
      // Bridge to richer user stores (e.g. shared-auth Postgres users +
      // organizations). Suzielaw uses this to set session.userId so the
      // billing controller can find the org for this signed-in user.
      if (opts.onSignIn) {
        await opts.onSignIn({
          profile: { email: profile.email, name: profile.name, subject: profile.subject },
          provider,
          session,
        });
      }
      res.redirect(opts.successRedirectPath ?? '/');
    } catch (err) {
      console.error('[hosted-demo.oauth] callback failed:', err instanceof Error ? err.message : err);
      res.status(401).send('OAuth sign-in failed');
    }
  });

  return router;
}

export function buildOAuthProvidersFromEnv(opts: {
  env: NodeJS.ProcessEnv;
  publicUrl: string;
  prefix?: string;
}): OAuthProviderConfig[] {
  const out: OAuthProviderConfig[] = [];
  const prefix = opts.prefix ?? '';
  const origin = opts.publicUrl.replace(/\/$/, '');
  const env = opts.env;

  const googleClientId = env[`${prefix}GOOGLE_CLIENT_ID`];
  const googleClientSecret = env[`${prefix}GOOGLE_CLIENT_SECRET`];
  if (googleClientId && googleClientSecret) {
    out.push({
      id: 'google',
      label: 'Google',
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: env[`${prefix}GOOGLE_REDIRECT_URI`] || `${origin}/api/auth/google/callback`,
    });
  }

  const microsoftClientId = env[`${prefix}MICROSOFT_CLIENT_ID`];
  const microsoftClientSecret = env[`${prefix}MICROSOFT_CLIENT_SECRET`];
  if (microsoftClientId && microsoftClientSecret) {
    out.push({
      id: 'microsoft',
      label: 'Microsoft',
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      tenant: env[`${prefix}MICROSOFT_TENANT`] || 'common',
      redirectUri: env[`${prefix}MICROSOFT_REDIRECT_URI`] || `${origin}/api/auth/microsoft/callback`,
    });
  }

  return out;
}

function buildAuthUrl(cfg: OAuthProviderConfig, state: string): URL {
  const url =
    cfg.id === 'google'
      ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
      : new URL(`https://login.microsoftonline.com/${cfg.tenant || 'common'}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  return url;
}

async function exchangeCodeForProfile(cfg: OAuthProviderConfig, code: string): Promise<OAuthProfile> {
  const tokenUrl =
    cfg.id === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : `https://login.microsoftonline.com/${cfg.tenant || 'common'}/oauth2/v2.0/token`;
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    }),
  });
  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => '');
    throw new Error(`token exchange failed (${tokenResponse.status}): ${text.slice(0, 200)}`);
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error('provider did not return an access token');

  const userInfoUrl =
    cfg.id === 'google'
      ? 'https://openidconnect.googleapis.com/v1/userinfo'
      : 'https://graph.microsoft.com/oidc/userinfo';
  const userInfo = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userInfo.ok) {
    const text = await userInfo.text().catch(() => '');
    throw new Error(`userinfo failed (${userInfo.status}): ${text.slice(0, 200)}`);
  }
  const profile = (await userInfo.json()) as {
    sub?: string;
    email?: string;
    preferred_username?: string;
    name?: string;
  };
  const email = String(profile.email || profile.preferred_username || '').trim().toLowerCase();
  if (!profile.sub || !email) throw new Error('provider profile missing subject or email');
  return {
    subject: profile.sub,
    email,
    name: String(profile.name || email).trim(),
  };
}

function providerFromParam(value: string | undefined): OAuthProviderId | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}
