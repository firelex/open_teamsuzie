import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createProgressiveArtifactHandler, parseNdjsonFromLlm,
} from '../progressive-artifact.js';

describe('createProgressiveArtifactHandler', () => {
  function appWith(handler: express.RequestHandler): express.Express {
    const app = express();
    app.use(express.json());
    app.post('/x', handler);
    return app;
  }

  it('SSE-encodes each yielded chunk and terminates with {done,total}', async () => {
    const handler = createProgressiveArtifactHandler<{ count: number }, { i: number }>({
      parseBody: (b) => ({ count: Number((b as { count?: number }).count ?? 0) }),
      async *run(body) {
        for (let i = 0; i < body.count; i++) yield { i };
      },
    });
    const res = await request(appWith(handler)).post('/x').send({ count: 3 });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('data: {"i":0}');
    expect(res.text).toContain('data: {"i":1}');
    expect(res.text).toContain('data: {"i":2}');
    expect(res.text).toContain('"done":true');
    expect(res.text).toContain('"total":3');
  });

  it('returns 400 when parseBody throws', async () => {
    const handler = createProgressiveArtifactHandler<{ x: number }, never>({
      parseBody: () => { throw new Error('bad body'); },
      async *run() { /* unreachable */ },
    });
    const res = await request(appWith(handler)).post('/x').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad body');
  });

  it('emits {error} terminal frame when run throws', async () => {
    const handler = createProgressiveArtifactHandler<unknown, never>({
      parseBody: (b) => b,
      // eslint-disable-next-line require-yield
      async *run() {
        throw new Error('boom');
      },
    });
    const res = await request(appWith(handler)).post('/x').send({});
    expect(res.status).toBe(200);
    expect(res.text).toContain('"error":"boom"');
    expect(res.text).not.toContain('"done":true');
  });

  it('still emits done with total when run yields nothing', async () => {
    const handler = createProgressiveArtifactHandler<unknown, never>({
      parseBody: (b) => b,
      async *run() { /* yield nothing */ },
    });
    const res = await request(appWith(handler)).post('/x').send({});
    expect(res.text).toContain('"done":true');
    expect(res.text).toContain('"total":0');
  });
});

describe('parseNdjsonFromLlm', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const x of iter) out.push(x);
    return out;
  }

  async function* fake(chunks: string[]): AsyncIterable<
    { type: 'chunk'; text: string } | { type: 'error'; message: string }
  > {
    for (const c of chunks) yield { type: 'chunk' as const, text: c };
  }

  it('parses one complete JSON line per yield', async () => {
    const llmStream = fake([
      '{"a":1}\n',
      '{"a":2}\n{"a":3}\n',
    ]);
    const out = await collect(parseNdjsonFromLlm({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmStream: llmStream as any,
      parseLine: (line) => JSON.parse(line) as { a: number },
    }));
    expect(out).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('buffers mid-line chunks across multiple events', async () => {
    const llmStream = fake(['{"a":1', ',"b":2}', '\n']);
    const out = await collect(parseNdjsonFromLlm({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmStream: llmStream as any,
      parseLine: (line) => JSON.parse(line),
    }));
    expect(out).toEqual([{ a: 1, b: 2 }]);
  });

  it('flushes the trailing line when no final newline arrives', async () => {
    const llmStream = fake(['{"a":1}']);
    const out = await collect(parseNdjsonFromLlm({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmStream: llmStream as any,
      parseLine: (line) => JSON.parse(line),
    }));
    expect(out).toEqual([{ a: 1 }]);
  });

  it('strips ```json code fences and skips array-wrapper lines', async () => {
    const llmStream = fake([
      '```json\n',
      '[\n',
      '{"a":1},\n',
      '{"a":2}\n',
      ']\n',
      '```\n',
    ]);
    const out = await collect(parseNdjsonFromLlm({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmStream: llmStream as any,
      parseLine: (line) => JSON.parse(line),
    }));
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('silently skips malformed lines (commentary, half-formed JSON)', async () => {
    const llmStream = fake([
      'Here are the topics:\n',
      '{"a":1}\n',
      'partial { not json\n',
      '{"a":2}\n',
    ]);
    const out = await collect(parseNdjsonFromLlm({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmStream: llmStream as any,
      parseLine: (line) => JSON.parse(line),
    }));
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('parseLine can return null to skip a structurally-valid but unwanted line', async () => {
    const llmStream = fake(['{"a":1}\n{"a":2}\n']);
    const out = await collect(parseNdjsonFromLlm({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      llmStream: llmStream as any,
      parseLine: (line) => {
        const v = JSON.parse(line) as { a: number };
        return v.a === 2 ? v : null;
      },
    }));
    expect(out).toEqual([{ a: 2 }]);
  });

  it('rethrows when the LLM stream yields an error event', async () => {
    async function* erroringStream() {
      yield { type: 'chunk' as const, text: '{"a":1}\n' };
      yield { type: 'error' as const, message: 'upstream blew up' };
    }
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const _ of parseNdjsonFromLlm({
        llmStream: erroringStream() as any,
        parseLine: (line) => JSON.parse(line),
      })) {
        void _;
      }
    }).rejects.toThrow(/upstream blew up/);
  });
});
