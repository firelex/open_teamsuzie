import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_PROCESSING_JOB,
  InMemoryJobStorage,
  JobQueue,
  SqliteJobStorage,
  createJobWorker,
} from '../index.js';

describe('@teamsuzie/jobs', () => {
  it('claims queued jobs by priority then creation order', () => {
    let tick = 0;
    const queue = new JobQueue({
      storage: new InMemoryJobStorage(),
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      idFactory: () => `job-${tick}`,
    });

    const low = queue.enqueueDocumentProcessing({
      operation: 'extract-text',
      inputFileId: 'file-low',
    }, { priority: 1 });
    const high = queue.enqueueDocumentProcessing({
      operation: 'extract-text',
      inputFileId: 'file-high',
    }, { priority: 10 });

    expect(queue.claimNext({ workerId: 'w1' })?.id).toBe(high.id);
    expect(queue.claimNext({ workerId: 'w1' })?.id).toBe(low.id);
  });

  it('runs a worker handler, records progress/events, and stores the result', async () => {
    const queue = new JobQueue({ storage: new InMemoryJobStorage() });
    const job = queue.enqueueModelInvocation({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const worker = createJobWorker({
      queue,
      workerId: 'worker-a',
      handlers: {
        'model.invocation': async (claimed, ctx) => {
          ctx.progress(25, 'Preparing prompt');
          ctx.event('model_selected', { model: claimed.payload });
          return { text: 'done' };
        },
      },
    });

    const completed = await worker.runOnce();
    expect(completed?.status).toBe('succeeded');
    expect(completed?.result).toEqual({ text: 'done' });
    expect(queue.get(job.id)?.progress).toEqual({ percent: 100, message: 'Completed' });
    expect(queue.events(job.id).map((event) => event.type)).toEqual([
      'started',
      'progress',
      'model_selected',
      'succeeded',
    ]);
  });

  it('reschedules failed jobs until maxAttempts is reached', async () => {
    let nowMs = Date.UTC(2026, 0, 1);
    const queue = new JobQueue({
      storage: new InMemoryJobStorage(),
      now: () => new Date(nowMs).toISOString(),
    });
    const job = queue.enqueueDocumentProcessing(
      { operation: 'convert-to-markdown', inputFileId: 'doc-1' },
      { maxAttempts: 2 },
    );
    const worker = createJobWorker({
      queue,
      retryDelayMs: 100,
      handlers: {
        [DOCUMENT_PROCESSING_JOB]: async () => {
          throw new Error('conversion failed');
        },
      },
    });

    const first = await worker.runOnce();
    expect(first?.status).toBe('queued');
    expect(first?.attempts).toBe(1);

    nowMs += 100;
    const second = await worker.runOnce();
    expect(second?.status).toBe('failed');
    expect(second?.attempts).toBe(2);
    expect(queue.get(job.id)?.error?.message).toBe('conversion failed');
  });

  it('persists jobs and events in sqlite storage', () => {
    const storage = SqliteJobStorage.open({ path: ':memory:' });
    const queue = new JobQueue({ storage });
    const job = queue.enqueueDocumentProcessing({
      operation: 'index',
      inputUri: 'file:///tmp/a.pdf',
    });
    queue.progress(job.id, { percent: 40, message: 'Chunking' });

    const reloaded = new JobQueue({ storage });
    expect(reloaded.get(job.id)?.payload).toEqual({
      operation: 'index',
      inputUri: 'file:///tmp/a.pdf',
    });
    expect(reloaded.events(job.id).map((event) => event.type)).toEqual(['progress']);
  });
});

