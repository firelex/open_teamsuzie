import type { OidcClient } from './OidcClient.ts';
import type { SessionBundle, SessionBundleRepo } from './SessionBundleRepo.ts';

const REFRESH_LEEWAY_MS = 60_000;

export async function ensureFreshAccessToken(args: {
  bundle: SessionBundle;
  oidc: OidcClient;
  repo: SessionBundleRepo;
  force?: boolean;
}): Promise<string> {
  const { bundle, oidc, repo, force = false } = args;
  const expiresAt = Date.parse(bundle.accessTokenExpiresAt);
  if (!force && expiresAt - Date.now() > REFRESH_LEEWAY_MS) return bundle.accessToken;
  const fresh = await oidc.refresh(bundle.refreshToken);
  if (!fresh.refresh_token) throw new Error('OIDC token endpoint did not return a new refresh token (rotation required)');
  const next = {
    accessToken: fresh.access_token,
    refreshToken: fresh.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  };
  await repo.updateTokens(bundle.sessionId, next);
  bundle.accessToken = next.accessToken;
  bundle.refreshToken = next.refreshToken;
  bundle.accessTokenExpiresAt = next.accessTokenExpiresAt;
  return next.accessToken;
}
