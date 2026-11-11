import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedAddress } from '../address.js';
import { BlockedDestinationError, fetchPage } from '../fetch-page.js';
import { braveSearch } from '../brave.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe('fetchPage', () => {
  // A local server reached through a fake DNS name that resolves to a
  // "public" address in the lookup, then to loopback for real.
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-private') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/` });
        res.end();
        return;
      }
      if (req.url === '/redirect-private-10') {
        res.writeHead(302, { location: 'http://10.0.0.1/admin' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>Hello</title><script>evil()</script></head><body><h1>Title</h1><p>Body <b>text</b></p></body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('refuses literal private addresses, local names and other schemes before connecting', async () => {
    await expect(fetchPage(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(fetchPage('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(fetchPage('http://localhost/')).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(fetchPage('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(fetchPage('http://user:pw@example.com/')).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('refuses a hostname whose DNS answer is private (checked at connect time)', async () => {
    const lookup = ((_h: string, _o: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
      cb(null, [{ address: '127.0.0.1', family: 4 }])) as never;
    await expect(fetchPage(`http://rebind.example:${port}/`, { lookup })).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  // Treat only loopback as public so the local server is reachable.
  const loopbackIsPublic = (ip: string) => ip !== '127.0.0.1' && isBlockedAddress(ip);
  const toLoopback = ((_h: string, _o: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
    cb(null, [{ address: '127.0.0.1', family: 4 }])) as never;

  it('returns a page as markdown with its title, without scripts', async () => {
    const page = await fetchPage(`http://site.example:${port}/`, { lookup: toLoopback, isBlocked: loopbackIsPublic });
    expect(page.title).toBe('Hello');
    expect(page.text).toContain('# Title');
    expect(page.text).toContain('Body **text**');
    expect(page.text).not.toContain('evil');
  });

  it('re-checks every redirect hop and refuses one that points at a private address', async () => {
    await expect(
      fetchPage(`http://site.example:${port}/redirect-private`, {
        lookup: toLoopback,
        isBlocked: (ip) => ip !== '127.0.0.1' && isBlockedAddress(ip),
      }),
    ).resolves.toBeDefined(); // loopback allowed here, so the redirect target 127.0.0.1 is followed
    await expect(
      fetchPage(`http://site.example:${port}/redirect-private-10`, { lookup: toLoopback, isBlocked: loopbackIsPublic }),
    ).rejects.toThrow(/10\.0\.0\.1 is a private or reserved address/);
  });
});

describe('braveSearch', () => {
  it('sends the key and returns cleaned results', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(
        JSON.stringify({ web: { results: [{ title: 'FCA <strong>fines</strong>', url: 'https://fca.org.uk/x', description: 'It&#x27;s new', age: '2 days ago' }, { title: 'no url' }] } }),
      );
    }) as unknown as typeof fetch;
    const out = await braveSearch('FCA fines', { apiKey: 'k', freshness: 'pw', fetchImpl });
    expect(seen!.url).toContain('q=FCA+fines');
    expect(seen!.url).toContain('freshness=pw');
    expect(seen!.headers['X-Subscription-Token']).toBe('k');
    expect(out).toEqual([{ title: 'FCA fines', url: 'https://fca.org.uk/x', snippet: "It's new", age: '2 days ago' }]);
  });

  it('surfaces API errors', async () => {
    const fetchImpl = (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch;
    await expect(braveSearch('x', { apiKey: 'k', fetchImpl })).rejects.toThrow(/429/);
  });
});
