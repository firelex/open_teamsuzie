import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { fetchMe, login, type AuthUser } from '../lib/auth';
import { testid } from '../lib/testids';

/**
 * The app-wide auth boundary. FIXED by the template — do not remove or bypass.
 *
 * On load it probes the session once. An anonymous user sees the login page and
 * NOTHING else; the shell, nav, and every data widget render only after sign-in.
 * This is why protected screens never have to show inline "Authentication
 * required" states as their primary unauthenticated UX — an unauthenticated user
 * simply can't reach them.
 *
 * The signed-in user is exposed to the authed subtree via `useAuth()`.
 */

interface AuthState {
  user: AuthUser;
}

const AuthContext = createContext<AuthState | null>(null);

/** Read the signed-in user. Only valid inside the authed subtree (below the gate). */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within an authenticated <AuthGate> subtree');
  return ctx;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'anon' }
  | { kind: 'authed'; user: AuthUser }
  | { kind: 'error'; message: string };

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetchMe(ctrl.signal)
      .then((user) => setStatus(user ? { kind: 'authed', user } : { kind: 'anon' }))
      .catch((err) => {
        if (!ctrl.signal.aborted) setStatus({ kind: 'error', message: String(err?.message ?? err) });
      });
    return () => ctrl.abort();
  }, []);

  if (status.kind === 'loading') {
    return (
      <div
        data-testid={testid.authLoading}
        className="min-h-screen grid place-items-center bg-neutral-50 text-neutral-500"
      >
        Checking your sign-in…
      </div>
    );
  }

  if (status.kind === 'authed') {
    return <AuthContext.Provider value={{ user: status.user }}>{children}</AuthContext.Provider>;
  }

  // 'anon' or 'error' → the login page. Routing 'error' here too means a flaky
  // /me never strands the user inside a half-broken app; they can retry sign-in.
  return <LoginScreen error={status.kind === 'error' ? status.message : null} />;
}

function LoginScreen({ error }: { error: string | null }) {
  return (
    <div
      data-testid={testid.loginScreen}
      className="min-h-screen grid place-items-center bg-neutral-50 p-6"
    >
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Sign in to continue</h1>
        <p className="mt-2 text-sm text-neutral-500">
          You need to sign in to access this workspace.
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-600">Couldn’t verify your session: {error}</p>
        )}
        <button
          type="button"
          data-testid={testid.loginButton}
          onClick={() => login()}
          className="mt-6 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
