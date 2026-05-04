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
 */
export function createCsrfMiddleware(opts: CsrfMiddlewareOptions = {}): RequestHandler {
  const cookieName = opts.cookieName ?? 'csrf-token';
  const secure = opts.secure ?? process.env.NODE_ENV === 'production';
  const skipPaths = new Set(opts.skipPaths ?? []);

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

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
