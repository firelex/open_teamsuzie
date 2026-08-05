import type { ChatMessage, ProviderId } from './types.js';
import type { ProviderConfig } from './providers.js';

/**
 * Provider-native web-search research calls. Same boundary rule as providers.ts:
 * this is the ONLY place that knows a provider's web-search wire shape.
 *
 * - Anthropic: the `web_search` SERVER tool on /messages — the provider runs its
 *   own multi-search loop and streams `server_tool_use` (the query) and
 *   `web_search_tool_result` (cited results) blocks alongside the text.
 * - Qwen (DashScope, OpenAI-compatible mode): `enable_search` + `search_options`
 *   on /chat/completions; sources come back as `search_info.search_results`.
 *
 * Both return the unified ResearchResult; providers without native search are
 * rejected with WebSearchUnsupportedError at the gateway.
 */

export interface ResearchCitation {
  url: string;
  title: string;
}

export interface ResearchResult {
  text: string;
  citations: ResearchCitation[];
  /** The provider-reported search queries actually executed. */
  searchQueries: string[];
}

export interface ResearchParams {
  config: ProviderConfig;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  /** Fires as each search query becomes known (live progress). */
  onSearch?: (query: string) => void;
}

export class WebSearchUnsupportedError extends Error {
  constructor(provider: string) {
    super(`Provider ${provider} has no native web-search support`);
    this.name = 'WebSearchUnsupportedError';
  }
}

/** Providers whose native web search researchChat can drive. */
export function providerSupportsWebSearch(provider: ProviderId): boolean {
  return provider === 'anthropic' || provider === 'qwen';
}

// --- Anthropic (streamed server tool) ---------------------------------------

const ANTHROPIC_WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as const;

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: {
    type?: string;
    name?: string;
    content?: Array<{ type?: string; url?: unknown; title?: unknown }>;
  };
  delta?: { type?: string; text?: unknown; partial_json?: unknown };
}

export async function researchAnthropic(p: ResearchParams): Promise<ResearchResult> {
  const system = p.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = p.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (p.apiKey) headers['x-api-key'] = p.apiKey;

  const res = await p.fetchImpl(`${p.config.baseUrl}/messages`, {
    method: 'POST',
    headers,
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens,
      ...(system ? { system } : {}),
      messages,
      stream: true,
      tools: [ANTHROPIC_WEB_SEARCH_TOOL],
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await safeText(res);
    throw new Error(`anthropic research request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  let text = '';
  const citations: ResearchCitation[] = [];
  const searchQueries: string[] = [];
  // Per-block state: the type announced by content_block_start, and (for
  // server_tool_use blocks) the accumulated input_json_delta fragments.
  const blockType = new Map<number, string>();
  const blockJson = new Map<number, string>();

  for await (const data of sseData(res)) {
    if (data === '[DONE]') break;
    let evt: AnthropicStreamEvent;
    try {
      evt = JSON.parse(data) as AnthropicStreamEvent;
    } catch {
      continue; // keep-alives / non-JSON lines
    }
    const idx = typeof evt.index === 'number' ? evt.index : -1;
    if (evt.type === 'content_block_start' && evt.content_block) {
      blockType.set(idx, evt.content_block.type ?? '');
      if (evt.content_block.type === 'web_search_tool_result') {
        for (const r of evt.content_block.content ?? []) {
          if (typeof r.url === 'string') {
            citations.push({ url: r.url, title: typeof r.title === 'string' ? r.title : r.url });
          }
        }
      }
    } else if (evt.type === 'content_block_delta' && evt.delta) {
      if (evt.delta.type === 'text_delta' && typeof evt.delta.text === 'string') {
        text += evt.delta.text;
      } else if (evt.delta.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
        blockJson.set(idx, (blockJson.get(idx) ?? '') + evt.delta.partial_json);
      }
    } else if (evt.type === 'content_block_stop' && blockType.get(idx) === 'server_tool_use') {
      const raw = blockJson.get(idx);
      if (raw) {
        try {
          const input = JSON.parse(raw) as { query?: unknown };
          if (typeof input.query === 'string' && input.query) {
            searchQueries.push(input.query);
            p.onSearch?.(input.query);
          }
        } catch {
          // Malformed tool input — skip the query, keep the rest of the stream.
        }
      }
    }
  }

  return { text, citations, searchQueries };
}

// --- Qwen (DashScope enable_search, OpenAI-compatible mode) ------------------

const QWEN_SEARCH_OPTIONS = {
  forced_search: false,
  enable_source: true,
  enable_citation: false,
  search_strategy: 'standard',
} as const;

interface QwenSearchInfo {
  search_results?: Array<{ url?: unknown; title?: unknown }>;
}

export async function researchQwen(p: ResearchParams): Promise<ResearchResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;

  // DashScope reports which sources it used but not its internal queries, so the
  // effective query (the user content) is surfaced once, up front.
  const query = p.messages.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
  if (query) p.onSearch?.(query);

  const res = await p.fetchImpl(`${p.config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      max_tokens: p.maxTokens,
      stream: false,
      enable_search: true,
      search_options: QWEN_SEARCH_OPTIONS,
    }),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`qwen research request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    search_info?: QwenSearchInfo;
    output?: { search_info?: QwenSearchInfo };
  };
  const content = json.choices?.[0]?.message?.content;
  const info = json.search_info ?? json.output?.search_info;
  const citations: ResearchCitation[] = [];
  for (const r of info?.search_results ?? []) {
    if (typeof r.url === 'string') {
      citations.push({ url: r.url, title: typeof r.title === 'string' ? r.title : r.url });
    }
  }
  return {
    text: typeof content === 'string' ? content : '',
    citations,
    searchQueries: query ? [query] : [],
  };
}

// --- SSE plumbing (mirrors providers.ts, which keeps its parser private) -----

async function* sseData(res: Response): AsyncIterable<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
