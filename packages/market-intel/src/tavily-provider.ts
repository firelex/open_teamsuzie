import type { MarketSearchOptions, MarketSearchProvider, MarketSearchResult } from './types.js';

export interface TavilyMarketSearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

interface TavilyResultItem {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResultItem[];
}

const DEFAULT_BASE_URL = 'https://api.tavily.com';

export class TavilyMarketSearchProvider implements MarketSearchProvider {
  readonly providerName = 'tavily';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: TavilyMarketSearchProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async search(query: string, opts: MarketSearchOptions = {}): Promise<MarketSearchResult> {
    if (!this.apiKey) {
      return { query, provider: this.providerName, hits: [], notConfigured: true };
    }

    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results: opts.limit ?? 10,
    };
    if (opts.recencyDays !== undefined) {
      body.days = opts.recencyDays;
      body.topic = 'news';
    }

    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Tavily search failed (${res.status})`);
    }

    const json = (await res.json()) as TavilyResponse;
    return {
      query,
      provider: this.providerName,
      hits: (json.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedAt: r.published_date,
        source: hostnameOf(r.url),
      })),
    };
  }
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
