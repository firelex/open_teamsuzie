import { randomUUID } from 'node:crypto';
import { jsonColumn, openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import type {
  ClaimNextJobOptions,
  EnqueueJobInput,
  JobError,
  JobEvent,
  JobRecord,
  JobStatus,
  JobStorage,
  ListJobsFilter,
  MarkFailedOptions,
} from './types.js';

function cloneJob(job: JobRecord): JobRecord {
  return {
    ...job,
    payload: cloneJson(job.payload),
    result: cloneJson(job.result),
    error: cloneJson(job.error),
    metadata: cloneJson(job.metadata) as Record<string, unknown>,
    progress: cloneJson(job.progress),
  };
}

function cloneEvent(event: JobEvent): JobEvent {
  return { ...event, data: cloneJson(event.data) };
}

function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function terminal(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return 100;
  return Math.min(Math.floor(limit), 500);
}

function matchesFilter(job: JobRecord, filter: ListJobsFilter = {}): boolean {
  if (filter.queue && job.queue !== filter.queue) return false;
  if (filter.kind && job.kind !== filter.kind) return false;
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!statuses.includes(job.status)) return false;
  }
  return true;
}

export class InMemoryJobStorage implements JobStorage {
  private jobs = new Map<string, JobRecord>();
  private events = new Map<string, JobEvent[]>();

  enqueue<TPayload, TMetadata extends Record<string, unknown>>(
    input: Required<EnqueueJobInput<TPayload, TMetadata>>,
    now: string,
  ): JobRecord<TPayload, null, TMetadata> {
    const job: JobRecord<TPayload, null, TMetadata> = {
      id: input.id,
      kind: input.kind,
      queue: input.queue,
      status: 'queued',
      payload: cloneJson(input.payload),
      result: null,
      error: null,
      metadata: cloneJson(input.metadata),
      priority: input.priority,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      availableAt: String(input.availableAt),
      lockedBy: null,
      lockedAt: null,
      progress: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.set(job.id, cloneJob(job) as JobRecord);
    return cloneJob(job) as JobRecord<TPayload, null, TMetadata>;
  }

  get(id: string): JobRecord | null {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : null;
  }

  list(filter: ListJobsFilter = {}): JobRecord[] {
    return [...this.jobs.values()]
      .filter((job) => matchesFilter(job, filter))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, normalizeLimit(filter.limit))
      .map(cloneJob);
  }

  claimNext(options: ClaimNextJobOptions, now: string): JobRecord | null {
    const candidate = [...this.jobs.values()]
      .filter((job) =>
        job.status === 'queued' &&
        job.availableAt <= now &&
        (!options.queue || job.queue === options.queue),
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.createdAt < b.createdAt ? -1 : 1;
      })[0];
    if (!candidate) return null;
    const next: JobRecord = {
      ...candidate,
      status: 'running',
      attempts: candidate.attempts + 1,
      lockedBy: options.workerId,
      lockedAt: now,
      startedAt: candidate.startedAt ?? now,
      updatedAt: now,
    };
    this.jobs.set(next.id, next);
    return cloneJob(next);
  }

  markSucceeded(id: string, result: unknown, now: string): JobRecord | null {
    const job = this.jobs.get(id);
    if (!job || terminal(job.status)) return job ? cloneJob(job) : null;
    const next = {
      ...job,
      status: 'succeeded' as const,
      result: cloneJson(result),
      error: null,
      lockedBy: null,
      lockedAt: null,
      progress: { percent: 100, message: 'Completed' },
      updatedAt: now,
      finishedAt: now,
    };
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  markFailed(id: string, error: JobError, opts: MarkFailedOptions): JobRecord | null {
    const job = this.jobs.get(id);
    if (!job || terminal(job.status)) return job ? cloneJob(job) : null;
    const retry = opts.retryAvailableAt && job.attempts < job.maxAttempts;
    const next = {
      ...job,
      status: retry ? 'queued' as const : 'failed' as const,
      error: cloneJson(error),
      lockedBy: null,
      lockedAt: null,
      availableAt: retry ? opts.retryAvailableAt! : job.availableAt,
      updatedAt: opts.now,
      finishedAt: retry ? null : opts.now,
    };
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  updateProgress(id: string, progress: { percent: number | null; message: string }, now: string): JobRecord | null {
    const job = this.jobs.get(id);
    if (!job || terminal(job.status)) return job ? cloneJob(job) : null;
    const next = { ...job, progress: cloneJson(progress), updatedAt: now };
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  cancel(id: string, now: string): JobRecord | null {
    const job = this.jobs.get(id);
    if (!job || terminal(job.status)) return job ? cloneJob(job) : null;
    const next = {
      ...job,
      status: 'cancelled' as const,
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
      finishedAt: now,
    };
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  retry(id: string, availableAt: string, now: string): JobRecord | null {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'failed') return job ? cloneJob(job) : null;
    const next = {
      ...job,
      status: 'queued' as const,
      error: null,
      progress: null,
      availableAt,
      updatedAt: now,
      finishedAt: null,
    };
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  appendEvent<TData>(event: JobEvent<TData>): void {
    const events = this.events.get(event.jobId) ?? [];
    events.push(cloneEvent(event as JobEvent));
    this.events.set(event.jobId, events);
  }

  listEvents(jobId: string): JobEvent[] {
    return (this.events.get(jobId) ?? []).map(cloneEvent);
  }
}

export interface SqliteJobStorageOptions {
  path: string;
  db?: never;
}

export interface SqliteJobStorageDbOptions {
  db: DatabaseInstance;
  path?: never;
}

type SqliteJobStorageOpenOptions = SqliteJobStorageOptions | SqliteJobStorageDbOptions;

interface JobRow {
  id: string;
  kind: string;
  queue_name: string;
  status: JobStatus;
  payload_json: string;
  result_json: string | null;
  error_json: string | null;
  metadata_json: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_by: string | null;
  locked_at: string | null;
  progress_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EventRow {
  id: string;
  job_id: string;
  type: string;
  data_json: string;
  created_at: string;
}

const MIGRATIONS = [{
  name: '20260607_jobs_queue',
  up: `
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      metadata_json TEXT NOT NULL,
      priority INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      locked_by TEXT,
      locked_at TEXT,
      progress_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_claim
      ON jobs (status, queue_name, available_at, priority DESC, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_jobs_list
      ON jobs (queue_name, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_events_job_created
      ON job_events (job_id, created_at ASC);
  `,
}];

export class SqliteJobStorage implements JobStorage {
  static open(options: SqliteJobStorageOpenOptions): SqliteJobStorage {
    if ('db' in options) {
      const db = options.db!;
      for (const migration of MIGRATIONS) db.exec(migration.up);
      return new SqliteJobStorage(db);
    }
    const db = openDb({ path: options.path, migrations: MIGRATIONS });
    return new SqliteJobStorage(db);
  }

  private constructor(private readonly db: DatabaseInstance) {}

  enqueue<TPayload, TMetadata extends Record<string, unknown>>(
    input: Required<EnqueueJobInput<TPayload, TMetadata>>,
    now: string,
  ): JobRecord<TPayload, null, TMetadata> {
    this.db.prepare(`
      INSERT INTO jobs (
        id, kind, queue_name, status, payload_json, result_json, error_json,
        metadata_json, priority, attempts, max_attempts, available_at,
        locked_by, locked_at, progress_json, created_at, updated_at,
        started_at, finished_at
      ) VALUES (?, ?, ?, 'queued', ?, NULL, NULL, ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL)
    `).run(
      input.id,
      input.kind,
      input.queue,
      jsonColumn.serialize(input.payload),
      jsonColumn.serialize(input.metadata),
      input.priority,
      input.maxAttempts,
      String(input.availableAt),
      now,
      now,
    );
    return this.get(input.id) as JobRecord<TPayload, null, TMetadata>;
  }

  get(id: string): JobRecord | null {
    const row = this.db.prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? this.rowToJob(row) : null;
  }

  list(filter: ListJobsFilter = {}): JobRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.queue) {
      where.push('queue_name = ?');
      params.push(filter.queue);
    }
    if (filter.kind) {
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const sql = `
      SELECT * FROM jobs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    params.push(normalizeLimit(filter.limit));
    return this.db.prepare(sql).all(...params).map((row) => this.rowToJob(row as JobRow));
  }

  claimNext(options: ClaimNextJobOptions, now: string): JobRecord | null {
    const tx = this.db.transaction(() => {
      const params: unknown[] = [now];
      let queueSql = '';
      if (options.queue) {
        queueSql = 'AND queue_name = ?';
        params.push(options.queue);
      }
      const row = this.db.prepare(`
        SELECT id FROM jobs
        WHERE status = 'queued'
          AND available_at <= ?
          ${queueSql}
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      `).get(...params) as { id: string } | undefined;
      if (!row) return null;
      this.db.prepare(`
        UPDATE jobs
        SET status = 'running',
            attempts = attempts + 1,
            locked_by = ?,
            locked_at = ?,
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(options.workerId, now, now, now, row.id);
      return this.get(row.id);
    });
    return tx();
  }

  markSucceeded(id: string, result: unknown, now: string): JobRecord | null {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'succeeded',
          result_json = ?,
          error_json = NULL,
          locked_by = NULL,
          locked_at = NULL,
          progress_json = ?,
          updated_at = ?,
          finished_at = ?
      WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
    `).run(
      jsonColumn.serialize(result),
      jsonColumn.serialize({ percent: 100, message: 'Completed' }),
      now,
      now,
      id,
    );
    return this.get(id);
  }

  markFailed(id: string, error: JobError, opts: MarkFailedOptions): JobRecord | null {
    const current = this.get(id);
    if (!current || terminal(current.status)) return current;
    const retry = opts.retryAvailableAt && current.attempts < current.maxAttempts;
    this.db.prepare(`
      UPDATE jobs
      SET status = ?,
          error_json = ?,
          locked_by = NULL,
          locked_at = NULL,
          available_at = ?,
          updated_at = ?,
          finished_at = ?
      WHERE id = ?
    `).run(
      retry ? 'queued' : 'failed',
      jsonColumn.serialize(error),
      retry ? opts.retryAvailableAt : current.availableAt,
      opts.now,
      retry ? null : opts.now,
      id,
    );
    return this.get(id);
  }

  updateProgress(id: string, progress: { percent: number | null; message: string }, now: string): JobRecord | null {
    this.db.prepare(`
      UPDATE jobs
      SET progress_json = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
    `).run(jsonColumn.serialize(progress), now, id);
    return this.get(id);
  }

  cancel(id: string, now: string): JobRecord | null {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'cancelled',
          locked_by = NULL,
          locked_at = NULL,
          updated_at = ?,
          finished_at = ?
      WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
    `).run(now, now, id);
    return this.get(id);
  }

  retry(id: string, availableAt: string, now: string): JobRecord | null {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'queued',
          error_json = NULL,
          progress_json = NULL,
          available_at = ?,
          updated_at = ?,
          finished_at = NULL
      WHERE id = ? AND status = 'failed'
    `).run(availableAt, now, id);
    return this.get(id);
  }

  appendEvent<TData>(event: JobEvent<TData>): void {
    this.db.prepare(`
      INSERT INTO job_events (id, job_id, type, data_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.jobId,
      event.type,
      jsonColumn.serialize(event.data),
      event.createdAt,
    );
  }

  listEvents(jobId: string): JobEvent[] {
    return this.db.prepare<[string], EventRow>(
      'SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC',
    ).all(jobId).map((row) => ({
      id: row.id,
      jobId: row.job_id,
      type: row.type,
      data: jsonColumn.parse(row.data_json),
      createdAt: row.created_at,
    }));
  }

  private rowToJob(row: JobRow): JobRecord {
    return {
      id: row.id,
      kind: row.kind,
      queue: row.queue_name,
      status: row.status,
      payload: jsonColumn.parse(row.payload_json),
      result: jsonColumn.parseNullable(row.result_json),
      error: jsonColumn.parseNullable(row.error_json),
      metadata: jsonColumn.parse(row.metadata_json),
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      lockedBy: row.locked_by,
      lockedAt: row.locked_at,
      progress: jsonColumn.parseNullable(row.progress_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}

export function createEvent<TData>(
  jobId: string,
  type: string,
  data: TData,
  createdAt: string,
): JobEvent<TData> {
  return {
    id: `evt-${randomUUID()}`,
    jobId,
    type,
    data,
    createdAt,
  };
}
