/**
 * Policy-driven base-URL validator shared by:
 *
 *   - "Local" model overrides in `@teamsuzie/model-settings` (only loopback,
 *     mDNS, or private-range targets are allowed — public hostnames are
 *     rejected to keep this UI off the SSRF foot-gun list).
 *
 *   - "Custom" LLM provider URLs in the PE settings host (the inverse:
 *     only public hostnames are allowed by default, with a dev escape hatch
 *     for pointing at ollama / LM Studio).
 *
 * Apps wire this into their `PUT /api/.../settings` style endpoint so the
 * server is the authority on which targets are allowed, even though the
 * client sends the candidate URL.
 *
 * Classifier policy: the `isLocalOrPrivateHost` predicate is the union of
 * everything we want to treat as "not on the public internet":
 *   - http(s)://localhost (incl. `*.localhost`)
 *   - http(s)://127.0.0.0/8, 0.0.0.0
 *   - http(s)://*.local   (mDNS / Bonjour)
 *   - http(s)://10.x  /  172.16-31.x  /  192.168.x  /  169.254.x (private IPv4)
 *   - http(s)://[::1] / [fc00::/7] / [fe80::/10] (IPv6 loopback / ULA / link-local)
 *
 * Both policies share that classifier; only the disposition (allow vs.
 * reject) differs. This avoids the historical drift where one side's
 * allow-list and the other side's reject-list disagreed on the edges
 * (e.g. `0.0.0.0`, mDNS, link-local IPv4).
 */

export type UrlPolicy = 'local-only' | 'public-only';

export interface ValidateProviderUrlOptions {
  /**
   * `'local-only'` — only loopback / private / mDNS hosts are allowed; used
   *   by the local-agent registry where the URL must point at the user's
   *   own machine.
   * `'public-only'` — only public hostnames are allowed; used by BYOK LLM
   *   provider URLs where the server may dial out to the user-supplied
   *   target (an SSRF surface unless we restrict it).
   */
  policy: UrlPolicy;
  /**
   * Escape hatch for `'public-only'`: when true, local/private hosts are
   * accepted too (useful in dev when pointing at ollama / LM Studio).
   * Ignored for `'local-only'`. Defaults to false.
   */
  allowLocalOverride?: boolean;
}

export interface ValidateLocalUrlResult {
  ok: boolean;
  reason?: string;
  /** Normalized form (no trailing slash, lowercase host). Only set when ok. */
  url?: string;
}

/**
 * Policy-driven URL validator. Returns `{ ok: true, url }` with a
 * normalized URL on success, `{ ok: false, reason }` otherwise.
 */
export function validateProviderUrl(
  input: string,
  opts: ValidateProviderUrlOptions,
): ValidateLocalUrlResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'URL is required' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a valid URL — include the protocol (http:// or https://).' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Protocol must be http or https (got "${parsed.protocol}").` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Embedded credentials are not allowed.' };
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal = isLocalOrPrivateHost(host);

  if (opts.policy === 'local-only' && !isLocal) {
    return {
      ok: false,
      reason:
        'Host must be loopback (localhost / 127.0.0.1), mDNS (*.local), or a private-range IP. Public hosts are rejected to prevent SSRF.',
    };
  }
  if (opts.policy === 'public-only' && isLocal && !opts.allowLocalOverride) {
    return {
      ok: false,
      reason:
        'Host is loopback / private; refusing to dial it from the server. Enable the local-override flag to allow it in dev.',
    };
  }

  // Normalize: strip trailing slash, lowercase host, preserve everything else.
  const normalized = `${parsed.protocol}//${host}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  return { ok: true, url: normalized };
}

/**
 * Back-compat wrapper for the original local-only validator. New callers
 * should use `validateProviderUrl(input, { policy: 'local-only' })`.
 */
export function validateLocalAgentUrl(input: string): ValidateLocalUrlResult {
  return validateProviderUrl(input, { policy: 'local-only' });
}

function isLocalOrPrivateHost(host: string): boolean {
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '::'
  ) {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;

  // IPv4 private + loopback + link-local ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 127) return true; // 127/8 loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  // IPv6 literal in brackets ([::1] etc.); URL parser may also strip
  // brackets, so handle both forms.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // ::ffff:a.b.c.d → IPv4-mapped, classify by the embedded IPv4.
  if (bare.toLowerCase().startsWith('::ffff:')) {
    return isLocalOrPrivateHost(bare.slice('::ffff:'.length));
  }
  //   ::1 / ::            loopback / unspecified
  //   fc00::/7            unique local (starts with fc or fd)
  //   fe80::/10           link-local (fe80 .. febf)
  if (bare === '::1' || bare === '::') return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(bare)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(bare)) return true;

  return false;
}
