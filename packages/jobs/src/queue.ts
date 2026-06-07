import { randomUUID } from 'node:crypto';
import { JobQueueError } from './errors.js';
import { createEvent } from './storage.js';
import {
  DOCUMENT_PROCESSING_JOB,
  MODEL_INVOCATION_JOB,
  type ClaimNextJobOptions,
  type DocumentProcessingPayload,
  type EnqueueJobInput,
  type JobEvent,
  type JobKind,
  type JobProgress,
  type JobRecord,
  type JobStorage,
  type ListJobsFilter,
  type ModelInvocationPayload,
} from './types.js';

export interface JobQueueOptions {
  storage: JobStorage;
  now?: () => string;
  idFactory?: () => string;
}

export interface RetryOptions {
  delayMs?: number;
}

export class JobQueue {
  private readonly storage: JobStorage;
  private readonly clock: () => string;
  private readonly newId: () => string;

  constructor(options: JobQueueOptions) {
    this.storage = options.storage;
    this.clock = options.now ?? (() => new Date().toISOString());
    this.newId = options.idFactory ?? (() => `job-${randomUUID()}`);
  }

  enqueue<TPayload, TMetadata extends Record<string, unknown> = Record<string, unknown>>(
    input: EnqueueJobInput<TPayload, TMetadata>,
  ): JobRecord<TPayload, null, TMetadata> {
    const now = this.clock();
    const availableAt = normalizeDate(input.availableAt ?? now);
    return this.storage.enqueue(
      {
        id: input.id ?? this.newId(),
        kind: input.kind,
        queue: input.queue ?? 'default',
        payload: input.payload,
        metadata: input.metadata ?? ({} as TMetadata),
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 1,
        availableAt,
      },
      now,
    );
  }

  enqueueModelInvocation(
    payload: ModelInvocationPayload,
    options: Omit<EnqueueJobInput<ModelInvocationPayload>, 'kind' | 'payload'> = {},
  ): JobRecord<ModelInvocationPayload, null> {
    return this.enqueue({
      ...options,
      kind: MODEL_INVOCATION_JOB,
      payload,
    });
  }

  enqueueDocumentProcessing(
    payload: DocumentProcessingPayload,
    options: Omit<EnqueueJobInput<DocumentProcessingPayload>, 'kind' | 'payload'> = {},
  ): JobRecord<DocumentProcessingPayload, null> {
    return this.enqueue({
      ...options,
      kind: DOCUMENT_PROCESSING_JOB,
      payload,
    });
  }

  get(id: string): JobRecord | null {
    return this.storage.get(id);
  }

  list(filter: ListJobsFilter = {}): JobRecord[] {
    return this.storage.list(filter);
  }

  events(jobId: string): JobEvent[] {
    return this.storage.listEvents(jobId);
  }

  cancel(id: string): JobRecord {
    const job = this.storage.cancel(id, this.clock());
    if (!job) throw new JobQueueError(`Job not found: ${id}`, 404);
    return job;
  }

  retryFailed(id: string, options: RetryOptions = {}): JobRecord {
    const now = this.clock();
    const availableAt = new Date(Date.parse(now) + (options.delayMs ?? 0)).toISOString();
    const job = this.storage.retry(id, availableAt, now);
    if (!job) throw new JobQueueError(`Failed job not found: ${id}`, 404);
    return job;
  }

  claimNext(options: ClaimNextJobOptions): JobRecord | null {
    return this.storage.claimNext(options, this.clock());
  }

  markSucceeded(id: string, result: unknown): JobRecord {
    const job = this.storage.markSucceeded(id, result, this.clock());
    if (!job) throw new JobQueueError(`Job not found: ${id}`, 404);
    this.event(id, 'succeeded', { result });
    return job;
  }

  markFailed(id: string, error: unknown, options: { retryDelayMs?: number } = {}): JobRecord {
    const now = this.clock();
    const retryAvailableAt = options.retryDelayMs == null
      ? null
      : new Date(Date.parse(now) + options.retryDelayMs).toISOString();
    const job = this.storage.markFailed(id, normalizeError(error), { now, retryAvailableAt });
    if (!job) throw new JobQueueError(`Job not found: ${id}`, 404);
    this.event(id, job.status === 'queued' ? 'retry_scheduled' : 'failed', {
      error: normalizeError(error),
      retryAvailableAt,
    });
    return job;
  }

  progress(id: string, progress: JobProgress): JobRecord {
    const bounded = {
      percent: progress.percent == null
        ? null
        : Math.max(0, Math.min(100, progress.percent)),
      message: progress.message,
    };
    const job = this.storage.updateProgress(id, bounded, this.clock());
    if (!job) throw new JobQueueError(`Job not found: ${id}`, 404);
    this.event(id, 'progress', bounded);
    return job;
  }

  event<TData>(jobId: string, type: string, data: TData): void {
    this.storage.appendEvent(createEvent(jobId, type, data, this.clock()));
  }
}

function normalizeDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeError(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
} {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const e = error as {
      message: string;
      name?: unknown;
      stack?: unknown;
      code?: unknown;
    };
    return {
      message: e.message,
      name: typeof e.name === 'string' ? e.name : undefined,
      stack: typeof e.stack === 'string' ? e.stack : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: typeof code === 'string' ? code : undefined,
    };
  }
  return { message: String(error) };
}

export function isBuiltInJobKind(kind: JobKind): kind is typeof MODEL_INVOCATION_JOB | typeof DOCUMENT_PROCESSING_JOB {
  return kind === MODEL_INVOCATION_JOB || kind === DOCUMENT_PROCESSING_JOB;
}
