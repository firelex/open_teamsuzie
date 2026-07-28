import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SessionBundleRepo } from './SessionBundleRepo.ts';
import type { OidcClient } from './OidcClient.ts';
import { ensureFreshAccessToken } from './tokenRefresh.ts';

// Per-app cookie name. Preview apps and the parent harness all run on
// localhost, and cookies are scoped by host NOT port — a shared name means one
// app's login overwrites/clears another's cookie and bounces the user out. The
// harness injects a unique SESSION_COOKIE_NAME per app; the default keeps this
// app distinct from the harness's own `suzie_session` when run standalone.
export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'suzie_app_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string; accessToken: string; tenantId: string };
      tenantId?: string;
    }
  }
}

/** Tiny Cookie-header parser — avoids pulling in cookie-parser for one use. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

/** Attaches req.user (incl. tenantId) if a valid session cookie is present and
 *  its access token can be (re)acquired. Never blocks; that's requireSession's job. */
export function attachSession(sessions: SessionBundleRepo, oidc: OidcClient): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sid = readCookie(req, SESSION_COOKIE);
    if (!sid) return next();
    let bundle;
    try {
      bundle = await sessions.get(sid);
    } catch {
      await sessions.delete(sid).catch(() => {});
      clearSessionCookie(res);
      return next();
    }
    if (!bundle) return next();
    if (Date.parse(bundle.expiresAt) < Date.now()) {
      await sessions.delete(sid).catch(() => {});
      clearSessionCookie(res);
      return next();
    }
    try {
      const accessToken = await ensureFreshAccessToken({ bundle, oidc, repo: sessions });
      req.user = { id: bundle.sub, email: bundle.email, name: bundle.name, accessToken, tenantId: bundle.tenantId };
    } catch {
      await sessions.delete(sid).catch(() => {});
      clearSessionCookie(res);
    }
    next();
  };
}

/** Reject unauthenticated callers with 401. Mount AFTER attachSession. */
export function requireSession(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    next();
  };
}
