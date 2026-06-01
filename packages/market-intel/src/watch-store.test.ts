import { describe, it, expect } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { MARKET_INTEL_MIGRATIONS } from './migrations.js';
import type { MarketSearchOptions, MarketSearchProvider, MarketSearchResult } from './types.js';
import { MarketWatchStore } from './watch-store.js';

class FakeProvider implements MarketSearchProvider {
  readonly providerName = 'fake';
  readonly calls: Array<{ query: string; opts?: MarketSearchOptions }> = [];

  constructor(private readonly opts: { notConfigured?: boolean; fail?: boolean } = {}) {}

  async search(query: string, opts?: MarketSearchOptions): Promise<MarketSearchResult> {
    this.calls.push({ query, opts });
    if (this.opts.fail) throw new Error('provider down');
    if (this.opts.notConfigured) return { query, provider: this.providerName, hits: [], notConfigured: true };
    return {
      query,
      provider: this.providerName,
      hits: [{
        title: `Result for ${query}`,
        url: `https://example.com/${encodeURIComponent(query)}`,
        snippet: 'A sourced market signal.',
        publishedAt: '2026-05-28T08:00:00.000Z',
        source: 'example.com',
      }],
    };
  }
}

function setup(provider = new FakeProvider()) {
  const db = openDb({ path: ':memory:', migrations: MARKET_INTEL_MIGRATIONS });
  return { db, provider, store: new MarketWatchStore({ db, provider }) };
}

describe('MarketWatchStore', () => {
  it('runs one search per category and persists normalized items', async () => {
    const { store, provider } = setup();
    const result = await store.run({
      subject: { id: 'subj_1', name: 'Acme' },
      categories: ['regulation', 'people'],
      queries: { regulation: 'Acme regulation', people: 'Acme CEO' },
      recencyDays: 7,
      limitPerCategory: 2,
      createdBy: 'analyst@example.com',
    });

    expect(result.run.status).toBe('completed');
    expect(result.run.notConfigured).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].subjectId).toBe('subj_1');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].opts).toMatchObject({ recencyDays: 7, limit: 2 });
  });

  it('records unconfigured provider state without items', async () => {
    const { store } = setup(new FakeProvider({ notConfigured: true }));
    const result = await store.run({
      subject: { id: 'subj_1', name: 'Acme' },
      categories: ['commercial'],
      queries: { commercial: 'Acme contract' },
      createdBy: 'analyst@example.com',
    });

    expect(result.run.status).toBe('completed');
    expect(result.run.notConfigured).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('marks runs failed when the provider throws', async () => {
    const { store } = setup(new FakeProvider({ fail: true }));
    const result = await store.run({
      subject: { id: 'subj_1', name: 'Acme' },
      categories: ['m_and_a'],
      queries: { m_and_a: 'Acme acquisition' },
      createdBy: 'analyst@example.com',
    });

    expect(result.run.status).toBe('failed');
    expect(result.run.error).toContain('provider down');
    expect(result.items).toEqual([]);
  });
});
