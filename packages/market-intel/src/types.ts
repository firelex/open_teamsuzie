export interface MarketSearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

export interface MarketSearchResult {
  query: string;
  provider: string;
  hits: MarketSearchHit[];
  notConfigured?: boolean;
}

export interface MarketSearchOptions {
  limit?: number;
  recencyDays?: number;
}

export interface MarketSearchProvider {
  readonly providerName: string;
  search(query: string, opts?: MarketSearchOptions): Promise<MarketSearchResult>;
}

export interface MarketWatchSubject {
  id: string;
  name: string;
  context?: Record<string, unknown>;
}

export interface MarketWatchRun {
  id: string;
  subjectId: string;
  provider: string;
  status: 'completed' | 'failed';
  categories: string[];
  queries: Record<string, string>;
  notConfigured: boolean;
  error: string | null;
  createdBy: string;
  createdAt: number;
  completedAt: number | null;
}

export interface MarketWatchItem {
  id: number;
  runId: string;
  subjectId: string;
  category: string;
  query: string;
  title: string;
  url: string;
  snippet: string;
  source: string | null;
  publishedAt: string | null;
  relevanceRationale: string;
  createdAt: number;
}
