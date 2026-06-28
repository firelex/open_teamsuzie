import { normalize, sep } from 'node:path';

/**
 * Reject anything that could escape a scoped root: empty, absolute, contains
 * `..` segments, or normalises to outside the root. Always returns POSIX-style
 * (forward-slash) paths so the web layer can round-trip them safely.
 *
 * Throws if the path is invalid.
 */
export function sanitizeSubpath(rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned) throw new Error('empty subpath');
  const normalized = normalize(cleaned);
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`) || normalized === '..') {
    throw new Error('subpath escapes scoped root');
  }
  return cleaned;
}

/**
 * For single-segment ids used as directory names (attachment ids, ticket ids
 * in path components): only allow A-Z, a-z, 0-9, `_`, `-`.
 */
export function sanitizeIdSegment(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid id segment: ${id}`);
  return id;
}

/**
 * Plain filename (no slashes, no `..`). Returns `null` if invalid so callers
 * can treat lookups as "not found" without throwing.
 */
export function isSafeFilename(name: string): boolean {
  return !name.includes('/') && !name.includes('\\') && !name.includes('..') && name.length > 0;
}
