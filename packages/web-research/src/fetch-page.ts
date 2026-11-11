import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';
import TurndownService from 'turndown';
import { isBlockedAddress } from './address.js';

export class BlockedDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedDestinationError';
  }
}

export interface FetchPageOptions {
  /** Stop reading after this many bytes. Default 2 MB. */
  maxBytes?: number;
  /** Characters of text returned. Default 40,000. */
  maxChars?: number;
  timeoutMs?: number;
  /** Redirect hops followed (each re-checked). Default 5. */
  maxRedirects?: number;
  /** DNS lookup, replaceable in tests. */
  lookup?: typeof dnsLookup;
  /** Which addresses to refuse. Default `isBlockedAddress`; tests narrow
   *  it to reach a local server. */
  isBlocked?: (ip: string) => boolean;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  contentType: string;
  /** Page content as markdown (HTML) or plain text. */
  text: string;
  truncated: boolean;
}

/**
 * An undici dispatcher whose DNS lookup refuses blocked addresses, so the
 * check applies to the address actually connected to (no window for a
 * rebinding answer between check and connect).
 */
function guardedAgent(lookup: typeof dnsLookup, isBlocked: (ip: string) => boolean): Agent {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        lookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return callback(err, '', 0);
          const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[];
          const bad = list.find((a) => isBlocked(a.address));
          if (list.length === 0 || bad) {
            return callback(
              new BlockedDestinationError(
                `${hostname} resolves to ${bad ? bad.address : 'no address'}, a private or reserved address`,
              ),
              '',
              0,
            );
          }
          // undici asks for all addresses; hand back the vetted list.
          (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
        });
      },
    },
  });
}

function checkUrl(raw: string, isBlocked: (ip: string) => boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedDestinationError(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedDestinationError(`only http and https URLs can be read (got ${url.protocol})`);
  }
  if (url.username || url.password) throw new BlockedDestinationError('URLs with credentials are not allowed');
  // Literal IPs (incl. [v6]) are checked here; hostnames at connect time.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isBlocked(host)) throw new BlockedDestinationError(`${host} is a private or reserved address`);
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new BlockedDestinationError(`${host} is a local hostname`);
  }
  return url;
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'nav', 'footer', 'header'] as never);

function htmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1]!.replace(/\s+/g, ' ').trim() || null : null;
}

async function readCapped(res: UndiciResponse, maxBytes: number): Promise<{ text: string; capped: boolean }> {
  if (!res.body) return { text: '', capped: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capped = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      capped = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), capped };
}

/**
 * Fetch a public web page and return its readable text. Refuses
 * non-http(s) URLs, credentials in URLs, local hostnames, and any host
 * that resolves to a private or reserved address; redirects are followed
 * by hand so every hop gets the same checks. HTML becomes markdown;
 * text/plain and JSON pass through; other types are refused.
 */
export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxChars = opts.maxChars ?? 40_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const isBlocked = opts.isBlocked ?? isBlockedAddress;
  const dispatcher = guardedAgent(opts.lookup ?? dnsLookup, isBlocked);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  try {
    let url = checkUrl(rawUrl, isBlocked);
    for (let hop = 0; ; hop++) {
      const res = await undiciFetch(url, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': 'TeamSuzie-WebResearch/0.1', Accept: 'text/html,text/plain,application/json;q=0.9' },
        dispatcher,
      }).catch((err: unknown) => {
        const cause = (err as { cause?: unknown }).cause;
        if (cause instanceof BlockedDestinationError) throw cause;
        throw err;
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= maxRedirects) throw new Error(`more than ${maxRedirects} redirects`);
        url = checkUrl(new URL(res.headers.get('location')!, url).toString(), isBlocked);
        continue;
      }
      if (!res.ok) throw new Error(`${url.host} answered ${res.status}`);
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';
      const isText = contentType.startsWith('text/') || contentType === 'application/json';
      if (!isHtml && !isText) {
        throw new Error(`${url.host} returned ${contentType || 'an unknown type'}, which cannot be read as a page`);
      }
      const { text: body, capped } = await readCapped(res, maxBytes);
      const text = isHtml ? turndown.turndown(body) : body;
      return {
        url: rawUrl,
        finalUrl: url.toString(),
        title: isHtml ? htmlTitle(body) : null,
        contentType,
        text: text.slice(0, maxChars),
        truncated: capped || text.length > maxChars,
      };
    }
  } finally {
    await dispatcher.close();
  }
}
