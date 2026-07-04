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
 */
export function login(
  returnTo: string = window.location.pathname + window.location.search,
  navigate: (url: string) => void = (url) => { window.location.assign(url); },
): void {
  navigate(`${LOGIN_PATH}?return_to=${encodeURIComponent(returnTo)}`);
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
