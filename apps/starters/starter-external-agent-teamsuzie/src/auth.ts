/**
 * Minimal auth gate for an external marketplace agent.
 *
 * Pipeline (all mounted on /api):
 *   1. validatePlatformRequest (from @teamsuzie/platform-bridge) — synthesizes
 *      req.session from a valid X-Platform-Token. No-op when the header is
 *      absent or wrong.
 *   2. injectDevSession — when AGENT_DEV_AUTH=true, fakes a session for any
 *      request that doesn't already have one. Refused at boot in production
 *      (see config.ts).
 *   3. requireAgentSession — 401 unless req.session.user is present. Skipped
 *      for the open allowlist (/api/health, /api/webhook/...).
 *
 * Standalone-product deployments (e.g. suzielaw, where real users hit the
 * agent's own UI directly) layer cookie auth from @teamsuzie/shared-auth in
 * front of step 3 — that middleware also populates req.session.user, so the
 * gate is unchanged.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface AgentSessionUser {
  email: string;
  name: string;
  role: string;
}

export interface AgentSession {
  user: AgentSessionUser;
}

const PUBLIC_PREFIXES = ['/health', '/webhook/'];

function isPublic(reqPath: string): boolean {
  // The middleware is mounted on /api, so req.path here is the segment
  // after that — e.g. `/health`, `/webhook/mothership`, `/chat`.
  return PUBLIC_PREFIXES.some((p) => reqPath === p || reqPath.startsWith(p));
}

export function injectDevSession(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const session = (req as any).session as AgentSession | undefined;
    if (!session?.user) {
      (req as any).session = {
        user: { email: 'dev@local', name: 'Local Dev', role: 'admin' },
      } satisfies AgentSession;
    }
    next();
  };
}

export function requireAgentSession(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isPublic(req.path)) {
      next();
      return;
    }
    const session = (req as any).session as AgentSession | undefined;
    if (!session?.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

export function getSessionUser(req: Request): AgentSessionUser | undefined {
  return ((req as any).session as AgentSession | undefined)?.user;
}
