import { timingSafeEqual } from 'node:crypto';

/** The token in an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
    const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
    return match ? match[1]!.trim() : null;
}

export function sameToken(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
