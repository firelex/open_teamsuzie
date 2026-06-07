import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { jwtVerify, createLocalJWKSet, type JWTPayload } from 'jose';
import { JwksCache, type JwksLike } from '../utils/jwks-cache.js';

export interface BearerJwtOptions {
    issuer: string;
    audience: string;
    requiredScope?: string;
    fetchJwks?: () => Promise<JwksLike>;
    fetchImpl?: typeof fetch;
}

interface OpenIdConfiguration {
    jwks_uri?: unknown;
}

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email?: string;
                name?: string;
                scope?: string;
                accessToken?: string;
                role?: string;
                firm_id?: string;
                firmId?: string;
                organization_id?: string;
                organizationId?: string;
            };
        }
    }
}

export function buildValidateBearerJwt(opts: BearerJwtOptions): RequestHandler {
    const fetcher = opts.fetchJwks ?? (() => fetchIssuerJwks(opts));
    const cache = new JwksCache(fetcher);

    return async (req: Request, res: Response, next: NextFunction) => {
        const header = req.headers.authorization ?? '';
        const match = /^Bearer\s+(.+)$/i.exec(header);
        if (!match) {
            res.status(401).json({ error: 'Unauthorized', message: 'Bearer token required' });
            return;
        }
        try {
            const jwks = await cache.get();
            const keyset = createLocalJWKSet(jwks as any);
            const { payload } = await jwtVerify(match[1], keyset, {
                issuer: opts.issuer,
                audience: opts.audience,
            });
            if (opts.requiredScope) {
                const scopes = String((payload as JWTPayload).scope ?? '').split(/\s+/);
                if (!scopes.includes(opts.requiredScope)) {
                    res.status(403).json({ error: 'Forbidden', message: `Missing scope: ${opts.requiredScope}` });
                    return;
                }
            }
            req.user = {
                id: String(payload.sub),
                email: (payload as any).email,
                name: (payload as any).name,
                scope: String((payload as JWTPayload).scope ?? ''),
                accessToken: match[1],
                role: (payload as any).role,
                firm_id: (payload as any).firm_id,
                firmId: (payload as any).firmId,
                organization_id: (payload as any).organization_id,
                organizationId: (payload as any).organizationId,
            };
            if ((req as any).session) {
                (req as any).session.userId = String(payload.sub);
            }
            next();
        } catch (err: any) {
            res.status(401).json({ error: 'Unauthorized', message: err?.message ?? 'invalid token' });
        }
    };
}

async function fetchIssuerJwks(opts: BearerJwtOptions): Promise<JwksLike> {
    const f = opts.fetchImpl ?? fetch;
    const discoveryUrl = new URL('/.well-known/openid-configuration', opts.issuer).toString();

    const discoveryRes = await f(discoveryUrl);
    if (discoveryRes.ok) {
        const discovery = await discoveryRes.json() as OpenIdConfiguration;
        if (typeof discovery.jwks_uri === 'string' && discovery.jwks_uri.length > 0) {
            return fetchJwksUrl(f, discovery.jwks_uri);
        }
    }

    for (const url of [
        new URL('/jwks', opts.issuer).toString(),
        new URL('/.well-known/jwks.json', opts.issuer).toString(),
    ]) {
        const res = await f(url);
        if (res.ok) return res.json() as Promise<JwksLike>;
    }

    throw new Error(`JWKS fetch failed: ${discoveryRes.status}`);
}

async function fetchJwksUrl(f: typeof fetch, url: string): Promise<JwksLike> {
    const res = await f(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    return res.json() as Promise<JwksLike>;
}
