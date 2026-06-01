import type { MarketSearchOptions, MarketSearchProvider, MarketSearchResult } from './types.js';

export class NoOpMarketSearchProvider implements MarketSearchProvider {
  readonly providerName = 'no-op';

  async search(query: string, _opts?: MarketSearchOptions): Promise<MarketSearchResult> {
    return {
      query,
      provider: this.providerName,
      hits: [],
      notConfigured: true,
    };
  }
}
