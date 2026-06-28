import { randomUUID } from 'node:crypto';
import { JobQueue, normalizeError } from './queue.js';
import type {
  JobHandler,
  JobHandlerContext,
  JobKind,
  JobRecord,
} from './types.js';

export interface JobWorkerOptions {
  queue: JobQueue;
  handlers: Partial<Record<JobKind, JobHandler>>;
  queueName?: string;
  workerId?: string;
  pollIntervalMs?: number;
  retryDelayMs?: number | ((job: JobRecord, error: unknown) => number | null);
}

export class JobWorker {
  private readonly queue: JobQueue;
  private readonly handlers: Partial<Record<JobKind, JobHandler>>;
  private readonly queueName?: string;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: NonNullable<JobWorkerOptions['retryDelayMs']>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly abortController = new AbortController();

  constructor(options: JobWorkerOptions) {
    this.queue = options.queue;
    this.handlers = options.handlers;
    this.queueName = options.queueName;
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.retryDelayMs = options.retryDelayMs ?? ((job) => Math.min(60_000, 1000 * 2 ** Math.max(0, job.attempts - 1)));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abortController.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<JobRecord | null> {
    const job = this.queue.claimNext({
      queue: this.queueName,
      workerId: this.workerId,
    });
    if (!job) return null;
    const handler = this.handlers[job.kind];
    if (!handler) {
      return this.queue.markFailed(job.id, new Error(`No handler registered for job kind: ${job.kind}`));
    }

    const ctx: JobHandlerContext = {
      workerId: this.workerId,
      signal: this.abortController.signal,
      progress: (percent, message) => {
        this.queue.progress(job.id, { percent, message });
      },
      event: (type, data) => {
        this.queue.event(job.id, type, data);
      },
    };

    try {
      this.queue.event(job.id, 'started', { workerId: this.workerId });
      const result = await handler(job, ctx);
      return this.queue.markSucceeded(job.id, result);
    } catch (error) {
      const retryDelayMs = typeof this.retryDelayMs === 'function'
        ? this.retryDelayMs(job, error)
        : this.retryDelayMs;
      return this.queue.markFailed(job.id, normalizeError(error), {
        retryDelayMs: retryDelayMs ?? undefined,
      });
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await this.runOnce().catch((error) => {
        // A worker-level error should not permanently stop background work.
        // The job-level path above records handler failures on the job.
        console.error(`[jobs] worker ${this.workerId} loop error:`, error);
      });
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, this.pollIntervalMs);
      });
    }
  }
}

export function createJobWorker(options: JobWorkerOptions): JobWorker {
  return new JobWorker(options);
}

