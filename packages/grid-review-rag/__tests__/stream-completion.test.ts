import { describe, it, expect } from 'vitest';
import { makeStreamCompletion } from '../src/stream-completion.js';

function makeMockFetch(sseLines: string[]): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('makeStreamCompletion', () => {
  it('decodes OpenAI-shaped SSE chunks and yields content text', async () => {
    const fetchImpl = makeMockFetch([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const stream = makeStreamCompletion({
      baseUrl: 'http://stub',
      apiKey: undefined,
      model: 'stub-model',
      fetchImpl,
    });
    const out = await collect(stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(out.join('')).toBe('hello world');
  });

  it('throws when response is non-2xx', async () => {
    const fetchImpl = (async () => new Response('{"error":"bad"}', { status: 400 })) as unknown as typeof fetch;
    const stream = makeStreamCompletion({
      baseUrl: 'http://stub',
      apiKey: undefined,
      model: 'stub-model',
      fetchImpl,
    });
    await expect(collect(stream({ messages: [{ role: 'user', content: 'hi' }] }))).rejects.toThrow(/400/);
  });

  it('skips malformed JSON chunks without crashing', async () => {
    const fetchImpl = makeMockFetch([
      'data: not-json\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const stream = makeStreamCompletion({
      baseUrl: 'http://stub',
      apiKey: undefined,
      model: 'stub-model',
      fetchImpl,
    });
    const out = await collect(stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(out.join('')).toBe('ok');
  });
});
