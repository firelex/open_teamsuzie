import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkRun } from './types.js';

/**
 * Persistence boundary for the work-runs store. The store treats the
 * full set of runs as one logical document; implementations are free to
 * back it with a flat JSON file, a SQLite row, an in-memory array, etc.
 *
 * Implementations are responsible for serialization — the store
 * passes/receives plain `WorkRun` objects.
 */
export interface WorkRunsStorage {
  readAll(): WorkRun[];
  writeAll(runs: WorkRun[]): void;
}

/**
 * Smallest useful implementation: a single JSON file containing
 * `{ runs: WorkRun[] }`. The parent directory is created on first
 * write so callers can point at a path under a workspace without
 * pre-creating it.
 */
export class JsonFileStorage implements WorkRunsStorage {
  constructor(private readonly filePath: string) {}

  readAll(): WorkRun[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed?.runs) ? (parsed.runs as WorkRun[]) : [];
    } catch {
      return [];
    }
  }

  writeAll(runs: WorkRun[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ runs }, null, 2));
  }
}

/** For tests and ephemeral hosts. */
export class InMemoryStorage implements WorkRunsStorage {
  private runs: WorkRun[] = [];

  readAll(): WorkRun[] {
    // Defensive copy — callers mutate-then-write, we shouldn't share state.
    return this.runs.map((r) => ({ ...r }));
  }

  writeAll(runs: WorkRun[]): void {
    this.runs = runs.map((r) => ({ ...r }));
  }
}
