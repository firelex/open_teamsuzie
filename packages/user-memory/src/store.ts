import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Per-user long-lived memory store.
 *
 * Each user gets one markdown file at `<memoryDir>/<userId-slug>.md`. The
 * agent reads it at the start of a conversation to surface stable facts
 * (firm name, drafting preferences, recurring deal patterns) and appends
 * to it when something genuinely new arrives that should persist across
 * sessions.
 *
 * Scope is deliberately narrow:
 *   - It is NOT a transcript of any single chat — for that, use the
 *     conversation store (`@teamsuzie/chats`).
 *   - It is NOT a workspace-scoped fact store — per-deal context belongs
 *     in the host app's workspace store, not here.
 *   - Append-only by default; full replace is exposed for explicit resets.
 *
 * Storage is plain markdown on disk so the user can inspect, edit, or
 * `grep` it directly. No DB schema, no migrations.
 */

export interface UserMemoryStoreOptions {
  /** Absolute path to the directory where per-user files live. Created on first write. */
  memoryDir: string;
}

export interface UserMemoryWriteResult {
  path: string;
  bytes: number;
}

const SLUG_FALLBACK = 'unknown-user';

/**
 * Filesystem-safe id derived from an email or any user identifier.
 * `mathias@blixt.example.com` → `mathias-blixt-example-com`.
 */
export function slugifyUserId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (!lower) return SLUG_FALLBACK;
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || SLUG_FALLBACK;
}

export class UserMemoryStore {
  constructor(private opts: UserMemoryStoreOptions) {}

  private pathFor(userId: string): string {
    return path.join(this.opts.memoryDir, `${slugifyUserId(userId)}.md`);
  }

  async read(userId: string): Promise<string> {
    try {
      return await readFile(this.pathFor(userId), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  /**
   * Append a single note to the user's memory. Each note gets a UTC
   * timestamp header so the agent (and the user) can see when it was
   * captured. Existing content is preserved verbatim — append-only.
   */
  async append(userId: string, note: string): Promise<UserMemoryWriteResult> {
    await mkdir(this.opts.memoryDir, { recursive: true });
    const fp = this.pathFor(userId);
    const existing = await this.read(userId);
    const entry = `## ${new Date().toISOString()}\n\n${note.trim()}\n`;
    const next = existing
      ? `${existing.trimEnd()}\n\n${entry}`
      : `# Memory\n\n${entry}`;
    await writeFile(fp, next, 'utf-8');
    return { path: fp, bytes: Buffer.byteLength(next, 'utf-8') };
  }

  /** Full overwrite — exposed for explicit user-requested resets. */
  async replace(userId: string, content: string): Promise<UserMemoryWriteResult> {
    await mkdir(this.opts.memoryDir, { recursive: true });
    const fp = this.pathFor(userId);
    await writeFile(fp, content, 'utf-8');
    return { path: fp, bytes: Buffer.byteLength(content, 'utf-8') };
  }

  /** Resolve the on-disk path for a user, without touching the file. */
  resolvePath(userId: string): string {
    return this.pathFor(userId);
  }
}
