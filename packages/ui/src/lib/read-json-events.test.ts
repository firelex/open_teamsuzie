import { describe, expect, it } from 'vitest';
import { readJsonEvents } from './read-json-events.js';

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }));
}

async function all(res: Response) {
  const out: unknown[] = [];
  for await (const e of readJsonEvents(res)) out.push(e);
  return out;
}

describe('readJsonEvents', () => {
  it('yields events split across chunks, in order', async () => {
    expect(await all(streamOf(['data: {"a":', '1}\n\ndata: {"b":2}\n', '\n: comment\n\ndata: {"c":3}']))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
  it('throws on an event that is not JSON', async () => {
    await expect(all(streamOf(['data: nope\n\n']))).rejects.toThrow(/not JSON/);
  });
});
