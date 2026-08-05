import { describe, it, expect } from 'vitest';

import {
  providerSupportsWebSearch,
  researchAnthropic,
  researchQwen,
  WebSearchUnsupportedError,
  type ResearchParams,
} from './research.js';
import { hostedProviders } from './providers.js';
import { ModelGateway } from './gateway.js';

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

function qwenParams(fetchImpl: typeof fetch, onSearch?: (q: string) => void): ResearchParams {
  return {
    config: hostedProviders({})['qwen'],
    apiKey: 'qk',
    model: 'qwen3.8-max',
    messages: [
      { role: 'system', content: 'be a researcher' },
      { role: 'user', content: 'uk legal market' },
    ],
    maxTokens: 1500,
    fetchImpl,
    onSearch,
  };
}

describe('researchQwen', () => {
  it('sends enable_search and collects text + search_info sources', async () => {
    let captured!: { url: string; init: RequestInit };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Finding B' } }],
          search_info: {
            search_results: [{ url: 'https://c.example/three', title: 'Three', site_name: 'C' }],
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const searches: string[] = [];
    const res = await researchQwen(qwenParams(fetchImpl, (q) => searches.push(q)));

    expect(res.text).toBe('Finding B');
    expect(res.citations).toEqual([{ url: 'https://c.example/three', title: 'Three' }]);
    expect(res.searchQueries).toEqual(['uk legal market']);
    expect(searches).toEqual(['uk legal market']);

    expect(captured.url).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    const body = JSON.parse(captured.init.body as string);
    expect(body.stream).toBe(false);
    expect(body.enable_search).toBe(true);
    // Research lanes ALWAYS search, and thinking mode must be off: with it on,
    // qwen3.8-max regularly blows past a 120s lane timeout (verified live).
    expect(body.enable_thinking).toBe(false);
    expect(body.search_options).toEqual({
      forced_search: true,
      enable_source: true,
      enable_citation: false,
      search_strategy: 'standard',
    });
    expect((captured.init.headers as Record<string, string>).authorization).toBe('Bearer qk');
  });

  it('returns no citations (without throwing) when search_info is absent', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'no sources' } }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const res = await researchQwen(qwenParams(fetchImpl));
    expect(res.text).toBe('no sources');
    expect(res.citations).toEqual([]);
  });

  it('reads search_info nested under output too', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'x' } }],
          output: { search_info: { search_results: [{ url: 'https://d.example', title: 'D' }] } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const res = await researchQwen(qwenParams(fetchImpl));
    expect(res.citations).toEqual([{ url: 'https://d.example', title: 'D' }]);
  });

  it('throws a descriptive error on a non-OK response', async () => {
    const fetchImpl = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    await expect(researchQwen(qwenParams(fetchImpl))).rejects.toThrow(/qwen research request failed \(401\)/);
  });
});

describe('providerSupportsWebSearch', () => {
  it('anthropic and qwen only', () => {
    expect(providerSupportsWebSearch('anthropic')).toBe(true);
    expect(providerSupportsWebSearch('qwen')).toBe(true);
    expect(providerSupportsWebSearch('openai')).toBe(false);
    expect(providerSupportsWebSearch('openai-compatible')).toBe(false);
  });
});

describe('ModelGateway.researchChat', () => {
  it('rejects a provider without native search', async () => {
    const notCalled = (async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { OPENAI_API_KEY: 'k' }, fetchImpl: notCalled });
    await expect(
      g.researchChat({ id: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(WebSearchUnsupportedError);
  });

  it('routes an anthropic id to the anthropic research adapter', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => {
      url = String(u);
      return new Response('data: {"type":"message_stop"}\n\n', { status: 200 });
    }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl });
    const res = await g.researchChat({
      id: 'anthropic/claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(res.provider).toBe('anthropic');
    expect(res.model).toBe('claude-sonnet-5');
  });
});
