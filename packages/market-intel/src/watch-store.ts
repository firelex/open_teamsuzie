import type { DatabaseInstance } from '@teamsuzie/db-sqlite';
import type {
  MarketSearchHit,
  MarketSearchProvider,
  MarketSearchResult,
  MarketWatchItem,
  MarketWatchRun,
  MarketWatchSubject,
} from './types.js';

export interface MarketWatchRunInput {
  subject: MarketWatchSubject;
  categories: string[];
  queries: Record<string, string>;
  createdBy: string;
  recencyDays?: number;
  limitPerCategory?: number;
  rationaleFor?: (input: {
    subject: MarketWatchSubject;
    category: string;
    hit: MarketSearchHit;
  }) => string;
}

export interface MarketWatchRunResult {
  run: MarketWatchRun;
  items: MarketWatchItem[];
  providerResults: MarketSearchResult[];
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function rowToRun(row: any): MarketWatchRun {
  return {
    id: row.id,
    subjectId: row.subject_id,
    provider: row.provider,
    status: row.status,
    categories: parseJson<string[]>(row.categories_json, []),
    queries: parseJson<Record<string, string>>(row.queries_json, {}),
    notConfigured: row.not_configured === 1,
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function rowToItem(row: any): MarketWatchItem {
  return {
    id: row.id,
    runId: row.run_id,
    subjectId: row.subject_id,
    category: row.category,
    query: row.query,
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    source: row.source,
    publishedAt: row.published_at,
    relevanceRationale: row.relevance_rationale,
    createdAt: row.created_at,
  };
}

function defaultRationale(input: {
  subject: MarketWatchSubject;
  category: string;
  hit: MarketSearchHit;
}): string {
  const bits = [`Matched ${input.category} watch for ${input.subject.name}`];
  if (input.hit.source) bits.push(`source=${input.hit.source}`);
  if (input.hit.publishedAt) bits.push(`published=${input.hit.publishedAt}`);
  return bits.join('; ');
}

export class MarketWatchStore {
  constructor(private readonly opts: { db: DatabaseInstance; provider: MarketSearchProvider }) {}

  getRun(id: string): MarketWatchRun | undefined {
    const row = this.opts.db.prepare(`SELECT * FROM market_watch_runs WHERE id = ?`).get(id);
    return row ? rowToRun(row) : undefined;
  }

  listRuns(opts: { subjectId: string; limit?: number }): MarketWatchRun[] {
    const limit = clampInt(opts.limit, 20, 1, 100);
    const rows = this.opts.db.prepare(
      `SELECT * FROM market_watch_runs WHERE subject_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(opts.subjectId, limit) as any[];
    return rows.map(rowToRun);
  }

  listItems(opts: { subjectId: string; runId?: string; limit?: number }): MarketWatchItem[] {
    const limit = clampInt(opts.limit, 50, 1, 250);
    const rows = opts.runId
      ? this.opts.db.prepare(
        `SELECT * FROM market_watch_items WHERE subject_id = ? AND run_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(opts.subjectId, opts.runId, limit) as any[]
      : this.opts.db.prepare(
        `SELECT * FROM market_watch_items WHERE subject_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(opts.subjectId, limit) as any[];
    return rows.map(rowToItem);
  }

  async run(input: MarketWatchRunInput): Promise<MarketWatchRunResult> {
    const now = Date.now();
    const runId = `mwr_${now}_${Math.random().toString(36).slice(2, 8)}`;
    this.opts.db.prepare(
      `INSERT INTO market_watch_runs
        (id, subject_id, provider, status, categories_json, queries_json, not_configured, error, created_by, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', ?, ?, 0, NULL, ?, ?, NULL)`,
    ).run(
      runId,
      input.subject.id,
      this.opts.provider.providerName,
      JSON.stringify(input.categories),
      JSON.stringify(input.queries),
      input.createdBy,
      now,
    );

    const recencyDays = clampInt(input.recencyDays, 14, 1, 365);
    const limitPerCategory = clampInt(input.limitPerCategory, 5, 1, 20);
    const rationaleFor = input.rationaleFor ?? defaultRationale;
    const providerResults: MarketSearchResult[] = [];
    let notConfigured = false;

    try {
      for (const category of input.categories) {
        const query = input.queries[category];
        if (!query) continue;
        const result = await this.opts.provider.search(query, {
          limit: limitPerCategory,
          recencyDays,
        });
        providerResults.push(result);
        if (result.notConfigured) {
          notConfigured = true;
          continue;
        }
        this.insertHits({
          runId,
          subject: input.subject,
          category,
          query,
          hits: result.hits,
          rationaleFor,
        });
      }
      this.opts.db.prepare(
        `UPDATE market_watch_runs SET not_configured = ?, completed_at = ? WHERE id = ?`,
      ).run(notConfigured ? 1 : 0, Date.now(), runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.db.prepare(
        `UPDATE market_watch_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
      ).run(message, Date.now(), runId);
    }

    return {
      run: this.getRun(runId)!,
      items: this.listItems({
        subjectId: input.subject.id,
        runId,
        limit: input.categories.length * limitPerCategory,
      }),
      providerResults,
    };
  }

  private insertHits(opts: {
    runId: string;
    subject: MarketWatchSubject;
    category: string;
    query: string;
    hits: MarketSearchHit[];
    rationaleFor: NonNullable<MarketWatchRunInput['rationaleFor']>;
  }): void {
    const now = Date.now();
    const stmt = this.opts.db.prepare(
      `INSERT OR IGNORE INTO market_watch_items
        (run_id, subject_id, category, query, title, url, snippet, source, published_at, relevance_rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const hit of opts.hits) {
      if (!hit.url) continue;
      stmt.run(
        opts.runId,
        opts.subject.id,
        opts.category,
        opts.query,
        hit.title || hit.url,
        hit.url,
        hit.snippet || '',
        hit.source ?? null,
        hit.publishedAt ?? null,
        opts.rationaleFor({ subject: opts.subject, category: opts.category, hit }),
        now,
      );
    }
  }
}
