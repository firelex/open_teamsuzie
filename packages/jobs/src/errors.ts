export class JobQueueError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'JobQueueError';
    this.status = status;
  }
}

