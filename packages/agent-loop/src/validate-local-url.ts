/**
 * Validate a base URL the user wants to point a "Local" model at. The
 * hostname must be loopback, mDNS, or a private-range IP — public hostnames
 * are rejected to keep this UI off the SSRF foot-gun list.
 *
 * Apps wire this into a `PUT /api/model-settings/:modelId` style endpoint so
 * the server is the authority on which targets are allowed, even though the
 * client sends the candidate URL.
 *
 * Allowed:
 *   - http(s)://localhost[:port]/...
 *   - http(s)://127.0.0.1[:port]/...
 *   - http(s)://0.0.0.0[:port]/...
 *   - http(s)://*.local[:port]/...   (mDNS / Bonjour)
 *   - http(s)://10.x.x.x  /  172.16-31.x.x  /  192.168.x.x  (private IPv4)
 *   - http(s)://[::1] / [fc00::/7] / [fe80::/10] (IPv6 loopback / ULA / link-local)
 *
 * Rejected:
 *   - anything else, embedded credentials, non-http schemes, malformed URLs.
 */
export interface ValidateLocalUrlResult {
  ok: boolean;
  reason?: string;
  /** Normalized form (no trailing slash, lowercase host). Only set when ok. */
  url?: string;
}

export function validateLocalAgentUrl(input: string): ValidateLocalUrlResult {
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
  if (!isLocalHostname(host)) {
    return {
      ok: false,
      reason:
        'Host must be loopback (localhost / 127.0.0.1), mDNS (*.local), or a private-range IP. Public hosts are rejected to prevent SSRF.',
    };
  }

  // Normalize: strip trailing slash, lowercase host, preserve everything else.
  const normalized = `${parsed.protocol}//${host}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  return { ok: true, url: normalized };
}

function isLocalHostname(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  if (host.endsWith('.local')) return true;

  // IPv4 private ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true; // loopback range
    return false;
  }

  // IPv6: rough check for loopback / unique local / link-local prefixes.
  // URL parser strips brackets, so host is bare. Common local prefixes:
  //   ::1 (loopback) — handled above
  //   fc00::/7 → starts with fc or fd
  //   fe80::/10 → starts with fe8/fe9/fea/feb
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;

  return false;
}
