import { describe, it, expect } from 'vitest';

import { researchAnthropic, type ResearchParams } from './research.js';
import { hostedProviders } from './providers.js';

/** Build an SSE response body from JSON payload lines. */
function sse(lines: string[]): Response {
  return new Response(lines.map((l) => `data: ${l}\n\n`).join(''), { status: 200 });
}

/** The realistic Anthropic streamed event sequence for one web search + text. */
const ANTHROPIC_SEARCH_EVENTS = [
  '{"type":"message_start","message":{"id":"m1"}}',
  '{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{}}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":"}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"uk legal roll-ups\\"}"}}',
  '{"type":"content_block_stop","index":0}',
  '{"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":[{"type":"web_search_result","url":"https://a.example/one","title":"One"},{"type":"web_search_result","url":"https://b.example/two","title":"Two"}]}}',
  '{"type":"content_block_stop","index":1}',
  '{"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}',
  '{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Finding "}}',
  '{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"A"}}',
  '{"type":"content_block_stop","index":2}',
  '{"type":"message_stop"}',
];

function anthropicParams(fetchImpl: typeof fetch, onSearch?: (q: string) => void): ResearchParams {
  return {
    config: hostedProviders({})['anthropic'],
    apiKey: 'ak',
    model: 'claude-sonnet-5',
    messages: [
      { role: 'system', content: 'be a researcher' },
      { role: 'user', content: 'uk legal market' },
    ],
    maxTokens: 1500,
    fetchImpl,
    onSearch,
  };
}

describe('researchAnthropic', () => {
  it('collects text, search queries, and cited results from the streamed tool events', async () => {
    let captured!: { url: string; init: RequestInit };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return sse(ANTHROPIC_SEARCH_EVENTS);
    }) as unknown as typeof fetch;

    const searches: string[] = [];
    const res = await researchAnthropic(anthropicParams(fetchImpl, (q) => searches.push(q)));

    expect(res.text).toBe('Finding A');
    expect(res.searchQueries).toEqual(['uk legal roll-ups']);
    expect(res.citations).toEqual([
      { url: 'https://a.example/one', title: 'One' },
      { url: 'https://b.example/two', title: 'Two' },
    ]);
    expect(searches).toEqual(['uk legal roll-ups']);

    // Wire shape: web_search server tool attached, streaming on, system hoisted.
    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(captured.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
    expect(body.system).toBe('be a researcher');
    expect(body.messages).toEqual([{ role: 'user', content: 'uk legal market' }]);
    expect((captured.init.headers as Record<string, string>)['x-api-key']).toBe('ak');
  });

  it('tolerates malformed tool input JSON (skips the query, keeps text/citations)', async () => {
    const fetchImpl = (async () =>
      sse([
        '{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"s1","name":"web_search","input":{}}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{not json"}}',
        '{"type":"content_block_stop","index":0}',
        '{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
        '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ok"}}',
        '{"type":"message_stop"}',
      ])) as unknown as typeof fetch;
    const res = await researchAnthropic(anthropicParams(fetchImpl));
    expect(res.text).toBe('ok');
    expect(res.searchQueries).toEqual([]);
    expect(res.citations).toEqual([]);
  });

  it('throws a descriptive error on a non-OK response', async () => {
    const fetchImpl = (async () => new Response('overloaded', { status: 529 })) as unknown as typeof fetch;
    await expect(researchAnthropic(anthropicParams(fetchImpl))).rejects.toThrow(
      /anthropic research request failed \(529\)/,
    );
  });
});
