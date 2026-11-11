import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEADER_NAME = 'x-csrf-token';

export interface CsrfMiddlewareOptions {
  /**
   * Non-HttpOnly cookie name the server mirrors the token to and the client
   * reads to populate the X-CSRF-Token request header.
   */
  cookieName?: string;
  /**
   * Set the Secure flag on the mirror cookie. Defaults to
   * `process.env.NODE_ENV === 'production'`.
   */
  secure?: boolean;
  /**
   * Request paths to exempt from the unsafe-method check. Matches `req.path`
   * exactly. OAuth callbacks are GET so they are already exempt; supply other
   * routes here if needed (e.g. webhooks signed out-of-band).
   */
  skipPaths?: string[];
  /**
   * Where the token lives. 'session' (default): in the session, mirrored
   * to the cookie (synchronizer token; right for cookie-session).
   * 'cookie': only in the SameSite=Strict cookie, checked against the
   * header (double-submit). Use 'cookie' with a server-side session store
   * (express-session + Redis): there, writing the token into the session
   * makes any request that arrives with a just-replaced session id (e.g.
   * a poll in flight during sign-in, which regenerates the session) create
   * and send a fresh empty session, overwriting the signed-in cookie.
   */
  storage?: 'session' | 'cookie';
}

interface CsrfSession {
  csrfToken?: string;
}

/**
 * Synchronizer-token CSRF middleware paired with `cookie-session`.
 *
 * The token lives in the signed session cookie, so the client cannot forge
 * it. On every request the same value is mirrored to a non-HttpOnly cookie
 * (`sameSite: 'strict'`) so client JS can read it and echo it back via the
 * `X-CSRF-Token` header. Unsafe methods (POST/PUT/PATCH/DELETE) require the
 * header to match; everything else passes through.
 *
 * Mount AFTER your session middleware and BEFORE any router that handles
 * mutating requests.
 *
 * Client-side helpers ship from `@teamsuzie/hosted-demo/client`
 * (`installCsrfFetch` / `csrfFetch`).
 */
export function createCsrfMiddleware(opts: CsrfMiddlewareOptions = {}): RequestHandler {
  const cookieName = opts.cookieName ?? 'csrf-token';
  const secure = opts.secure ?? process.env.NODE_ENV === 'production';
  const skipPaths = new Set(opts.skipPaths ?? []);

  if (opts.storage === 'cookie') {
    return function csrfDoubleSubmit(req: Request, res: Response, next: NextFunction): void {
      const cookies = parseCookies(req.headers.cookie);
      let token = cookies[cookieName];
      if (!token || !/^[0-9a-f]{64}$/.test(token)) {
        token = randomBytes(32).toString('hex');
        res.cookie(cookieName, token, { httpOnly: false, sameSite: 'strict', secure, path: '/' });
      }
      if (UNSAFE_METHODS.has(req.method) && !skipPaths.has(req.path)) {
        const header = String(req.headers[HEADER_NAME] ?? '');
        if (!safeEqual(header, token)) {
          res.status(403).json({ error: 'csrf_token_mismatch' });
          return;
        }
      }
      next();
    };
  }

  return function csrf(req: Request, res: Response, next: NextFunction): void {
    const session = (req as unknown as { session?: CsrfSession | null }).session;
    if (!session) {
      res.status(500).json({ error: 'session_not_initialized' });
      return;
    }

    if (!session.csrfToken) {
      session.csrfToken = randomBytes(32).toString('hex');
    }

    res.cookie(cookieName, session.csrfToken, {
      httpOnly: false,
      sameSite: 'strict',
      secure,
      path: '/',
    });

    if (UNSAFE_METHODS.has(req.method) && !skipPaths.has(req.path)) {
      const header = String(req.headers[HEADER_NAME] ?? '');
      if (!safeEqual(header, session.csrfToken)) {
        res.status(403).json({ error: 'csrf_token_mismatch' });
        return;
      }
    }

    next();
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (!(key in out)) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
