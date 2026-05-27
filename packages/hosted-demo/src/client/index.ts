/**
 * Browser-only CSRF fetch helpers paired with `createCsrfMiddleware` from
 * `@teamsuzie/hosted-demo`. Reads the non-HttpOnly mirror cookie the server
 * sets and injects an `X-CSRF-Token` request header on unsafe methods.
 *
 * No `node:*` imports — this module is meant to be bundled into client code.
 */

const DEFAULT_COOKIE_NAME = 'csrf-token';
const DEFAULT_HEADER_NAME = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface InstallCsrfFetchOptions {
  /** Cookie name to read. Default 'csrf-token' (matches server default). */
  cookieName?: string;
  /** Request header name to inject. Default 'X-CSRF-Token'. */
  headerName?: string;
  /** Additional hosts (beyond same registrable site) to inject header for. */
  trustedHosts?: string[];
}

/**
 * Parse `document.cookie` and return the decoded value for `cookieName`, or
 * `null` if the cookie is missing. Returns `null` outside a browser context.
 */
export function readCsrfToken(cookieName: string = DEFAULT_COOKIE_NAME): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const raw of cookies) {
    const eq = raw.indexOf('=');
    if (eq === -1) continue;
    const name = raw.slice(0, eq).trim();
    if (name !== cookieName) continue;
    const value = raw.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * Thin wrapper around the global `fetch`. On unsafe methods (POST/PUT/PATCH/
 * DELETE) and a same-site target, reads the CSRF cookie and shallow-merges
 * an `X-CSRF-Token` header into `init.headers`. An explicitly-provided header
 * of the same name (case-insensitive) is preserved.
 *
 * Always calls `globalThis.fetch` at call time so callers go through whatever
 * `window.fetch` is currently installed (e.g. after `installCsrfFetch`).
 */
export function csrfFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: InstallCsrfFetchOptions = {},
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return globalThis.fetch(input, init);
  }

  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const headerName = opts.headerName ?? DEFAULT_HEADER_NAME;
  const token = readCsrfToken(cookieName);
  if (!token) {
    return globalThis.fetch(input, init);
  }

  if (!isSameSite(input, opts.trustedHosts)) {
    return globalThis.fetch(input, init);
  }

  const merged = mergeCsrfHeader(init, headerName, token);
  return globalThis.fetch(input, merged);
}

/**
 * Monkey-patch `window.fetch` with the `csrfFetch` behavior above. Idempotent:
 * a second call is a no-op and returns the same restore function. The
 * returned `restore()` puts the original `window.fetch` back.
 *
 * No-op (returns a no-op restore) when invoked outside a browser context.
 */
export function installCsrfFetch(opts: InstallCsrfFetchOptions = {}): () => void {
  if (typeof window === 'undefined') {
    return NOOP_RESTORE;
  }
  if (installed) {
    return cachedRestore;
  }

  originalFetch = window.fetch.bind(window);
  const patched: typeof fetch = (input, init) => csrfFetch(input, init, opts);
  window.fetch = patched;
  installed = true;

  cachedRestore = () => {
    if (!installed) return;
    if (originalFetch) {
      window.fetch = originalFetch;
    }
    installed = false;
    originalFetch = null;
    cachedRestore = NOOP_RESTORE;
  };
  return cachedRestore;
}

// --- module-private state for installCsrfFetch idempotency ---
let installed = false;
let originalFetch: typeof fetch | null = null;
const NOOP_RESTORE: () => void = () => {};
let cachedRestore: () => void = NOOP_RESTORE;

function mergeCsrfHeader(
  init: RequestInit | undefined,
  headerName: string,
  token: string,
): RequestInit {
  const next: RequestInit = { ...(init ?? {}) };
  const existing = init?.headers;

  // Detect a caller-supplied header with the same name (case-insensitive) so
  // we don't clobber it.
  const lowerTarget = headerName.toLowerCase();
  const hasExisting = headersHasName(existing, lowerTarget);
  if (hasExisting) {
    next.headers = existing;
    return next;
  }

  if (existing instanceof Headers) {
    const copy = new Headers(existing);
    copy.set(headerName, token);
    next.headers = copy;
  } else if (Array.isArray(existing)) {
    next.headers = [...existing, [headerName, token]];
  } else if (existing && typeof existing === 'object') {
    next.headers = { ...(existing as Record<string, string>), [headerName]: token };
  } else {
    next.headers = { [headerName]: token };
  }
  return next;
}

function headersHasName(headers: HeadersInit | undefined, lowerName: string): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) {
    return headers.has(lowerName);
  }
  if (Array.isArray(headers)) {
    return headers.some(([k]) => typeof k === 'string' && k.toLowerCase() === lowerName);
  }
  return Object.keys(headers as Record<string, string>).some(
    (k) => k.toLowerCase() === lowerName,
  );
}

function isSameSite(input: RequestInfo | URL, trustedHosts?: string[]): boolean {
  if (typeof window === 'undefined') return false;
  const here = window.location;
  let url: URL;
  try {
    if (typeof input === 'string') {
      url = new URL(input, here.href);
    } else if (input instanceof URL) {
      url = input;
    } else {
      // Request object
      url = new URL((input as Request).url, here.href);
    }
  } catch {
    // Unparseable — treat as same-site (relative-ish) and let fetch decide.
    return true;
  }

  const target = url.hostname;
  const self = here.hostname;
  if (target === self) return true;

  // localhost special case: 'localhost' or '127.0.0.1' on both sides counts
  // as same-site regardless of port.
  if (isLoopback(target) && isLoopback(self)) {
    // Only treat matching loopback families as same-site.
    if (target === self) return true;
    // Allow both 'localhost' or both '127.0.0.1'; mixing also acceptable
    // because dev servers commonly proxy across them.
    return true;
  }

  if (trustedHosts && trustedHosts.includes(target)) return true;

  // Naive eTLD+1 approximation — caller can extend via trustedHosts.
  return registrableSite(target) === registrableSite(self);
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

function registrableSite(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}
