export interface RegisteredClient {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'client_secret_post' | 'client_secret_basic';
  scope: string;
}

/**
 * Each first-party client is configured by triple of env vars:
 *   OIDC_CLIENT_<NAME>_ID, _SECRET, _REDIRECT_URIS (comma-separated).
 */
export function loadClientRegistry(env: NodeJS.ProcessEnv | Record<string, string | undefined>): RegisteredClient[] {
  const out: RegisteredClient[] = [];
  for (const key of Object.keys(env)) {
    const m = /^OIDC_CLIENT_([A-Z0-9_]+)_ID$/.exec(key);
    if (!m) continue;
    const slug = m[1];
    const client_id = env[key]!;
    const client_secret = env[`OIDC_CLIENT_${slug}_SECRET`];
    const redirect = env[`OIDC_CLIENT_${slug}_REDIRECT_URIS`];
    if (!client_secret) throw new Error(`OIDC_CLIENT_${slug}_SECRET is required`);
    if (!redirect) throw new Error(`OIDC_CLIENT_${slug}_REDIRECT_URIS is required (comma-separated redirect_uris)`);
    out.push({
      client_id,
      client_secret,
      redirect_uris: redirect.split(',').map((s) => s.trim()).filter(Boolean),
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'openid profile email tools offline_access',
    });
  }
  return out;
}
