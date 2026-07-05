/**
 * Client auth actions + session check.
 *
 * Auth is always OAuth/OIDC — there is no password path. The whole app sits
 * behind <AuthGate>, which calls `fetchMe()` once on load: an anonymous user
 * sees the login page and never the app shell, so protected `/api/*` calls (and
 * their inline "Authentication required" states) are never reached unauthed.
 *
 * Same-origin + credentialed; sends no tenant/firm id — the server derives the
 * tenant from the session.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Server route that (re)starts the OIDC sign-in flow. */
export const LOGIN_PATH = '/api/auth/login';

/**
 * Fired when an authenticated `/api` call is rejected with 401 so <AuthGate>
 * can drop a now-stale session back to the login page instead of letting
 * pollers spam 401s. A session can die (expire / lose its refresh token) while
 * the SPA stays mounted; the gate only probes `/api/auth/me` once at load, so
 * without this the stale user keeps the shell — and its data pollers — alive.
 *
 * REQUIRED WIRING: your API client must call `notifyUnauthorized(res.status)`
 * on every `/api` response (see AGENTS.md). It is a no-op unless the status is
 * 401, so it is safe to call unconditionally after each fetch.
 */
export const AUTH_UNAUTHORIZED_EVENT = 'suzie:unauthorized';

export function notifyUnauthorized(status: number): void {
  if (status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
}

/**
 * Session probe. GET `/api/auth/me` → the signed-in user, or `null` when the
 * server says 401 (not signed in). Any other status is a real error and throws,
 * so the gate can distinguish "anonymous" from "auth service is down".
 */
export async function fetchMe(signal?: AbortSignal): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include', signal });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`session check failed (${res.status})`);
  return (await res.json()) as AuthUser;
}

/**
 * Start sign-in: send the browser to the server OIDC login route, preserving
 * where the user was so the callback can return them there.
 *
 * Navigates the TOP-LEVEL window. OIDC providers refuse to be framed
 * (clickjacking protection via `frame-ancestors`), so when this app is embedded
 * — e.g. in the harness preview iframe — the sign-in redirect must break out to
 * the top window or the provider page is blocked and sign-in silently fails. The
 * URL is absolute because `window.top` may be a different origin.
 */
export function login(
  returnTo: string = window.location.pathname + window.location.search,
  navigate: (url: string) => void = topNavigate,
): void {
  navigate(`${window.location.origin}${LOGIN_PATH}?return_to=${encodeURIComponent(returnTo)}`);
}

function topNavigate(url: string): void {
  const top = window.top && window.top !== window ? window.top : window;
  try {
    top.location.href = url; // break out of an embedding iframe for the auth redirect
  } catch {
    window.location.href = url; // sandbox forbids top navigation — fall back to self
  }
}

/**
 * Sign out: POST `/api/auth/logout` (clears the session cookie server-side),
 * then reload at the app root. AuthGate re-probes, finds no session, and shows
 * the login page — so no authenticated view stays open on a stale client.
 * Best-effort: even if the POST fails we still send the user back to the gate.
 * The navigation is injectable so it is testable without a browser.
 */
export async function logout(
  navigate: (url: string) => void = (url) => { window.location.assign(url); },
): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    /* best effort — still send the user back to the gate below */
  }
  navigate('/');
}
