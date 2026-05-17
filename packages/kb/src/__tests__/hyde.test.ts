import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HYDE_FORMAT_HINTS,
  rewriteQueryAsHypothetical,
  type HydeOptions,
} from '../hyde.js';

interface CapturedRequest {
  url: string;
  body: any;
  headers: Record<string, string>;
}

function makeMockFetch(
  responseBody: string,
  opts: { status?: number } = {},
): { fetchImpl: typeof fetch; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const headersInit = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) : null;
    captured.push({ url, body, headers: headersInit });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: responseBody } }],
      }),
      {
        status: opts.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };
  return { fetchImpl, captured };
}

const baseOpts = (fetchImpl: typeof fetch): HydeOptions => ({
  baseUrl: 'https://example.test',
  apiKey: 'sk-test',
  model: 'simple-1',
  fetchImpl,
});

describe('rewriteQueryAsHypothetical', () => {
  it('uses default format hints when no override is passed', async () => {
    const { fetchImpl, captured } = makeMockFetch('Delaware.');
    await rewriteQueryAsHypothetical(
      'what is the governing law?',
      'short_text',
      baseOpts(fetchImpl),
    );
    const systemMsg = captured[0]!.body.messages[0].content as string;
    expect(systemMsg).toContain(DEFAULT_HYDE_FORMAT_HINTS.short_text);
  });

  it('uses a custom format hint when supplied via formatHints', async () => {
    const { fetchImpl, captured } = makeMockFetch('Pending vendor reply.');
    await rewriteQueryAsHypothetical('vendor reply on tax exposure?', 'qlog', {
      ...baseOpts(fetchImpl),
      formatHints: { qlog: 'Phrase as a single audit-trail sentence.' },
    });
    const systemMsg = captured[0]!.body.messages[0].content as string;
    expect(systemMsg).toContain('Phrase as a single audit-trail sentence.');
  });

  it('falls back to the text hint when the format key is missing', async () => {
    const { fetchImpl, captured } = makeMockFetch('Whatever.');
    await rewriteQueryAsHypothetical(
      'does X apply?',
      'nonexistent',
      baseOpts(fetchImpl),
    );
    const systemMsg = captured[0]!.body.messages[0].content as string;
    expect(systemMsg).toContain(DEFAULT_HYDE_FORMAT_HINTS.text);
  });

  it('strips wrapping double-quotes from the response', async () => {
    const { fetchImpl } = makeMockFetch('"Delaware governs."');
    const out = await rewriteQueryAsHypothetical('q', 'text', baseOpts(fetchImpl));
    expect(out).toBe('Delaware governs.');
  });

  it('strips wrapping single-quotes from the response', async () => {
    const { fetchImpl } = makeMockFetch("'Delaware governs.'");
    const out = await rewriteQueryAsHypothetical('q', 'text', baseOpts(fetchImpl));
    expect(out).toBe('Delaware governs.');
  });

  it('returns only the first sentence when the response has multiple', async () => {
    const { fetchImpl } = makeMockFetch(
      'Delaware governs the agreement. Other state law may apply.',
    );
    const out = await rewriteQueryAsHypothetical('q', 'text', baseOpts(fetchImpl));
    expect(out).toBe('Delaware governs the agreement.');
  });

  it('throws when the response content is empty', async () => {
    const { fetchImpl } = makeMockFetch('');
    await expect(
      rewriteQueryAsHypothetical('q', 'text', baseOpts(fetchImpl)),
    ).rejects.toThrow(/empty/);
  });

  it('throws when the HTTP response is not OK', async () => {
    const { fetchImpl } = makeMockFetch('ignored', { status: 500 });
    await expect(
      rewriteQueryAsHypothetical('q', 'text', baseOpts(fetchImpl)),
    ).rejects.toThrow(/500/);
  });

  it('merges extraBody into the request body (enable_thinking case)', async () => {
    const { fetchImpl, captured } = makeMockFetch('ok.');
    await rewriteQueryAsHypothetical('q', 'text', {
      ...baseOpts(fetchImpl),
      extraBody: { enable_thinking: false },
    });
    expect(captured[0]!.body.enable_thinking).toBe(false);
  });

  it('sets the Authorization header when apiKey is provided', async () => {
    const { fetchImpl, captured } = makeMockFetch('ok.');
    await rewriteQueryAsHypothetical('q', 'text', baseOpts(fetchImpl));
    expect(captured[0]!.headers.Authorization).toBe('Bearer sk-test');
  });

  it('omits the Authorization header when apiKey is undefined', async () => {
    const { fetchImpl, captured } = makeMockFetch('ok.');
    await rewriteQueryAsHypothetical('q', 'text', {
      ...baseOpts(fetchImpl),
      apiKey: undefined,
    });
    expect(captured[0]!.headers.Authorization).toBeUndefined();
  });

  it('strips trailing slash from baseUrl when constructing the request URL', async () => {
    const { fetchImpl, captured } = makeMockFetch('ok.');
    await rewriteQueryAsHypothetical('q', 'text', {
      ...baseOpts(fetchImpl),
      baseUrl: 'https://example.test/',
    });
    expect(captured[0]!.url).toBe('https://example.test/v1/chat/completions');
  });
});
