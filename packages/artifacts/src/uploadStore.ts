import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { sanitizeSubpath } from './safePath.js';

export interface ScopedUpload {
  /** Relative POSIX path inside the upload root. */
  name: string;
  size: number;
  modified: string;
}

/**
 * Stores files inside a single root directory and prevents escapes via
 * {@link sanitizeSubpath}. Cleans up empty parent dirs on delete so an empty
 * subtree disappears with the last file. Meant for ad-hoc user uploads
 * scoped to one artifact (e.g. spec uploads, briefing attachments).
 */
export class ScopedUploadStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  list(): ScopedUpload[] {
    if (!existsSync(this.root)) return [];
    const out: ScopedUpload[] = [];
    const walk = (abs: string, rel: string): void => {
      for (const name of readdirSync(abs)) {
        const childAbs = join(abs, name);
        const childRel = rel ? `${rel}/${name}` : name;
        const st = statSync(childAbs);
        if (st.isDirectory()) walk(childAbs, childRel);
        else out.push({ name: childRel, size: st.size, modified: st.mtime.toISOString() });
      }
    };
    walk(this.root, '');
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  save(relativePath: string, data: Buffer): ScopedUpload {
    const rel = sanitizeSubpath(relativePath);
    const abs = join(this.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    const st = statSync(abs);
    return { name: rel, size: st.size, modified: st.mtime.toISOString() };
  }

  read(relativePath: string): Buffer | null {
    let rel: string;
    try {
      rel = sanitizeSubpath(relativePath);
    } catch {
      return null;
    }
    const abs = join(this.root, rel);
    if (!existsSync(abs)) return null;
    return readFileSync(abs);
  }

  delete(relativePath: string): void {
    let rel: string;
    try {
      rel = sanitizeSubpath(relativePath);
    } catch {
      return;
    }
    const abs = join(this.root, rel);
    try {
      unlinkSync(abs);
    } catch {
      /* already gone */
    }
    // Walk parent directories upward, removing empty ones up to (but not
    // including) the upload root.
    let dir = dirname(abs);
    while (dir.startsWith(this.root) && dir !== this.root) {
      try {
        const remaining = readdirSync(dir);
        if (remaining.length > 0) break;
        rmdirSync(dir);
      } catch {
        break;
      }
      dir = dirname(dir);
    }
  }
}
