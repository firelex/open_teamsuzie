import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { sanitizeIdSegment } from './safePath.js';

/**
 * Minimal contract an activity entry must satisfy so the store can validate
 * persisted JSON. Hosts widen this with their own kinds, authors, metadata.
 */
export interface ActivityEntryShape {
  id: string;
  body: string;
}

export interface ActivityLogOptions<TEntry extends ActivityEntryShape> {
  /** Directory containing `<subjectId>.json` files. */
  dir: string;
  /**
   * Optional validator run on each entry loaded from disk. Return `false` to
   * drop malformed entries silently. Defaults to a shape check.
   */
  validate?: (raw: unknown) => raw is TEntry;
}

/**
 * Append-only JSON activity log keyed by subject id. One file per subject,
 * holds an array of host-defined entries. Reads tolerate missing/malformed
 * files (returning `[]`) so the log is safe to call on subjects that never
 * had activity recorded.
 */
export class ActivityLog<TEntry extends ActivityEntryShape> {
  private readonly dir: string;
  private readonly validate: (raw: unknown) => raw is TEntry;

  constructor(options: ActivityLogOptions<TEntry>) {
    this.dir = options.dir;
    this.validate = options.validate ?? defaultValidator<TEntry>;
  }

  private pathFor(subjectId: string): string {
    return join(this.dir, `${sanitizeIdSegment(subjectId)}.json`);
  }

  list(subjectId: string): TEntry[] {
    const p = this.pathFor(subjectId);
    if (!existsSync(p)) return [];
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e): e is TEntry => this.validate(e));
    } catch {
      return [];
    }
  }

  /**
   * Replace the entire entry list for a subject. Used by hosts that need to
   * splice in synthetic entries (e.g. status-change rows) alongside an
   * append.
   */
  replaceAll(subjectId: string, entries: TEntry[]): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.pathFor(subjectId), JSON.stringify(entries, null, 2));
  }

  append(subjectId: string, entry: TEntry): TEntry {
    const entries = [...this.list(subjectId), entry];
    this.replaceAll(subjectId, entries);
    return entry;
  }

  delete(subjectId: string): void {
    try {
      unlinkSync(this.pathFor(subjectId));
    } catch {
      /* idempotent */
    }
  }
}

function defaultValidator<TEntry extends ActivityEntryShape>(raw: unknown): raw is TEntry {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as { id?: unknown; body?: unknown };
  return typeof r.id === 'string' && typeof r.body === 'string';
}
