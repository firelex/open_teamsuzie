import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
    namespace Express {
        interface Request {
            keyHash?: string;
        }
    }
}

/**
 * Extract Bearer token from Authorization header and compute SHA256 hash.
 * The hash is used for agent attribution in usage events (matches user_api_key_hash).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        res.status(401).json({ error: 'Empty Bearer token' });
        return;
    }

    req.keyHash = crypto.createHash('sha256').update(token).digest('hex');
    next();
}
