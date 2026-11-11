export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Publication age as Brave reports it, e.g. "3 days ago". */
  age: string | null;
}

export interface BraveSearchOptions {
  apiKey: string;
  /** Results to return, 1 to 20. Default 8. */
  count?: number;
  /** Recency filter: past day, week, month or year. */
  freshness?: 'pd' | 'pw' | 'pm' | 'py';
  /** Two-letter country code to bias results, e.g. "GB". */
  country?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface BraveResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
}

/** Strip the <strong> highlight tags Brave puts in snippets. */
function plain(s: string): string {
  return s.replace(/<\/?strong>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Web search through the Brave Search API. */
export async function braveSearch(query: string, opts: BraveSearchOptions): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) throw new Error('search query is empty');
  const params = new URLSearchParams({ q, count: String(Math.min(20, Math.max(1, opts.count ?? 8))) });
  if (opts.freshness) params.set('freshness', opts.freshness);
  if (opts.country) params.set('country', opts.country.toUpperCase());
  const base = (opts.baseUrl ?? 'https://api.search.brave.com/res/v1').replace(/\/$/, '');
  const res = await (opts.fetchImpl ?? fetch)(`${base}/web/search?${params}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': opts.apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brave search ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as BraveResponse;
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: plain(r.title ?? ''),
      url: r.url!,
      snippet: plain(r.description ?? ''),
      age: r.age ?? null,
    }));
}
