// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { csrfFetch, installCsrfFetch, readCsrfToken } from './index.js';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

function clearAllCookies(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

function getHeader(init: RequestInit | undefined, name: string): string | null {
  if (!init?.headers) return null;
  const lower = name.toLowerCase();
  if (init.headers instanceof Headers) return init.headers.get(name);
  if (Array.isArray(init.headers)) {
    for (const [k, v] of init.headers) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }
  for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

describe('readCsrfToken', () => {
  beforeEach(() => {
    clearAllCookies();
  });

  it('returns the decoded cookie value', () => {
    document.cookie = 'csrf-token=abc123; path=/';
    expect(readCsrfToken()).toBe('abc123');
  });

  it('returns null when cookie is missing', () => {
    expect(readCsrfToken()).toBeNull();
  });

  it('honors a custom cookie name', () => {
    document.cookie = 'my-csrf=xyz; path=/';
    expect(readCsrfToken('my-csrf')).toBe('xyz');
  });
});

describe('csrfFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearAllCookies();
    setLocation('http://localhost:19270/');
    fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects X-CSRF-Token header on POST when cookie present', async () => {
    document.cookie = 'csrf-token=tok-1; path=/';
    await csrfFetch('/api/foo', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(getHeader(init, 'X-CSRF-Token')).toBe('tok-1');
  });

  it('does not inject header on GET', async () => {
    document.cookie = 'csrf-token=tok-1; path=/';
    await csrfFetch('/api/foo');
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(getHeader(init, 'X-CSRF-Token')).toBeNull();
  });

  it('does not inject when cross-site and no trustedHosts match', async () => {
    document.cookie = 'csrf-token=tok-1; path=/';
    await csrfFetch('https://evil.example.com/api', { method: 'POST' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(getHeader(init, 'X-CSRF-Token')).toBeNull();
  });

  it('treats localhost:19270 ↔ localhost:19280 as same-site (different ports)', async () => {
    document.cookie = 'csrf-token=tok-2; path=/';
    await csrfFetch('http://localhost:19280/api/foo', { method: 'POST' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(getHeader(init, 'X-CSRF-Token')).toBe('tok-2');
  });

  it('honors trustedHosts allowlist', async () => {
    document.cookie = 'csrf-token=tok-3; path=/';
    await csrfFetch(
      'https://api.elsewhere.test/x',
      { method: 'POST' },
      { trustedHosts: ['api.elsewhere.test'] },
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(getHeader(init, 'X-CSRF-Token')).toBe('tok-3');
  });

  it('preserves an explicit X-CSRF-Token header (case-insensitive)', async () => {
    document.cookie = 'csrf-token=tok-auto; path=/';
    await csrfFetch('/api/foo', {
      method: 'POST',
      headers: { 'x-csrf-token': 'explicit' },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(getHeader(init, 'X-CSRF-Token')).toBe('explicit');
  });

  it('treats foo.example.com ↔ bar.example.com as same registrable site', async () => {
    setLocation('https://foo.example.com/');
    document.cookie = 'csrf-token=tok-4; path=/';
    await csrfFetch('https://bar.example.com/api', { method: 'POST' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(getHeader(init, 'X-CSRF-Token')).toBe('tok-4');
  });
});

describe('installCsrfFetch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    clearAllCookies();
    setLocation('http://localhost:19270/');
    originalFetch = vi.fn().mockResolvedValue(new Response('ok')) as unknown as typeof fetch;
    window.fetch = originalFetch;
  });

  it('patches window.fetch and injects header on POST', async () => {
    document.cookie = 'csrf-token=tok-5; path=/';
    const restore = installCsrfFetch();
    try {
      await window.fetch('/api/x', { method: 'POST' });
      const mock = originalFetch as unknown as ReturnType<typeof vi.fn>;
      const init = mock.mock.calls[0][1] as RequestInit;
      expect(getHeader(init, 'X-CSRF-Token')).toBe('tok-5');
    } finally {
      restore();
    }
  });

  it('second call no-ops and returns the same restore', () => {
    const r1 = installCsrfFetch();
    const r2 = installCsrfFetch();
    try {
      expect(r2).toBe(r1);
    } finally {
      r1();
    }
  });

  it('restore() puts original window.fetch back', () => {
    const before = window.fetch;
    const restore = installCsrfFetch();
    expect(window.fetch).not.toBe(before);
    restore();
    expect(window.fetch).toBe(before);
  });

  it('csrfFetch + installCsrfFetch do not infinite-loop', async () => {
    // Regression test for a bug where csrfFetch used globalThis.fetch,
    // which after install IS the patched function — every csrfFetch call
    // recursed into patched, which recursed into csrfFetch, blowing the
    // stack on every fetch in the app. Fix: csrfFetch uses the captured
    // pre-patch fetch (`originalFetch`) when install is active.
    setLocation('http://localhost:5173/');
    const realOriginal = window.fetch;
    const mock = vi.fn(async () =>
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    window.fetch = mock as unknown as typeof fetch;

    const restore = installCsrfFetch();
    try {
      // Both entry points must terminate without recursing.
      const direct = await csrfFetch('/api/health');
      expect(direct.status).toBe(200);

      const viaPatched = await window.fetch('/api/health');
      expect(viaPatched.status).toBe(200);

      // The underlying real fetch was called exactly twice (once per call
      // above), proving no recursion.
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      restore();
      // Put the real jsdom fetch back so the next test's "restore" check
      // doesn't compare against the test-local mock.
      window.fetch = realOriginal;
    }
  });
});
