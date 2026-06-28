export const MODEL_INVOCATION_JOB = 'model.invocation' as const;
export const DOCUMENT_PROCESSING_JOB = 'document.processing' as const;

export type BuiltInJobKind =
  | typeof MODEL_INVOCATION_JOB
  | typeof DOCUMENT_PROCESSING_JOB;

export type JobKind = BuiltInJobKind | (string & {});

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface JobError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
}

export interface JobProgress {
  percent: number | null;
  message: string;
}

export interface JobRecord<
  TPayload = unknown,
  TResult = unknown,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  kind: JobKind;
  queue: string;
  status: JobStatus;
  payload: TPayload;
  result: TResult | null;
  error: JobError | null;
  metadata: TMetadata;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedBy: string | null;
  lockedAt: string | null;
  progress: JobProgress | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobEvent<TData = unknown> {
  id: string;
  jobId: string;
  type: string;
  data: TData;
  createdAt: string;
}

export interface EnqueueJobInput<
  TPayload = unknown,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  id?: string;
  kind: JobKind;
  queue?: string;
  payload: TPayload;
  metadata?: TMetadata;
  priority?: number;
  maxAttempts?: number;
  availableAt?: string | Date;
}

export interface ModelInvocationPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: unknown;
  tools?: unknown[];
}

export interface DocumentProcessingPayload {
  inputFileId?: string;
  inputUri?: string;
  inputMimeType?: string;
  operation:
    | 'convert-to-markdown'
    | 'export-docx'
    | 'export-pdf'
    | 'extract-text'
    | 'index'
    | (string & {});
  options?: Record<string, unknown>;
}

export interface ListJobsFilter {
  queue?: string;
  kind?: JobKind;
  status?: JobStatus | JobStatus[];
  limit?: number;
}

export interface ClaimNextJobOptions {
  queue?: string;
  workerId: string;
}

export interface JobStorage {
  enqueue<TPayload, TMetadata extends Record<string, unknown>>(
    input: Required<EnqueueJobInput<TPayload, TMetadata>>,
    now: string,
  ): JobRecord<TPayload, null, TMetadata>;
  get(id: string): JobRecord | null;
  list(filter?: ListJobsFilter): JobRecord[];
  claimNext(options: ClaimNextJobOptions, now: string): JobRecord | null;
  markSucceeded(id: string, result: unknown, now: string): JobRecord | null;
  markFailed(id: string, error: JobError, opts: MarkFailedOptions): JobRecord | null;
  updateProgress(id: string, progress: JobProgress, now: string): JobRecord | null;
  cancel(id: string, now: string): JobRecord | null;
  retry(id: string, availableAt: string, now: string): JobRecord | null;
  appendEvent<TData>(event: JobEvent<TData>): void;
  listEvents(jobId: string): JobEvent[];
}

export interface MarkFailedOptions {
  now: string;
  retryAvailableAt: string | null;
}

export type JobHandler<TResult = unknown> = (
  job: JobRecord,
  ctx: JobHandlerContext,
) => Promise<TResult> | TResult;

export interface JobHandlerContext {
  workerId: string;
  progress(percent: number | null, message: string): void;
  event<TData = unknown>(type: string, data: TData): void;
  signal: AbortSignal;
}
