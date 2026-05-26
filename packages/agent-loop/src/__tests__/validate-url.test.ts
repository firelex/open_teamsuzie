import { describe, expect, it } from 'vitest';
import {
  validateLocalAgentUrl,
  validateProviderUrl,
} from '../validate-local-url.js';

describe('validateProviderUrl: local-only policy', () => {
  it('accepts loopback, mDNS, and private IPv4 hosts', () => {
    const ok = [
      'http://localhost:11434/v1',
      'http://127.0.0.1:11434',
      'http://0.0.0.0:8080',
      'http://my-box.local',
      'http://10.0.5.1/v1',
      'http://172.16.42.1/v1',
      'http://172.31.255.255/v1',
      'http://192.168.1.10/v1',
      'http://169.254.169.254/latest',
    ];
    for (const url of ok) {
      const r = validateProviderUrl(url, { policy: 'local-only' });
      expect(r.ok, `expected ok for ${url}: ${r.reason}`).toBe(true);
    }
  });

  it('rejects public hostnames', () => {
    const bad = ['https://api.openai.com/v1', 'https://example.com', 'http://8.8.8.8'];
    for (const url of bad) {
      const r = validateProviderUrl(url, { policy: 'local-only' });
      expect(r.ok, `expected reject for ${url}`).toBe(false);
    }
  });

  it('validateLocalAgentUrl is the back-compat shim', () => {
    expect(validateLocalAgentUrl('http://localhost').ok).toBe(true);
    expect(validateLocalAgentUrl('https://example.com').ok).toBe(false);
  });
});

describe('validateProviderUrl: public-only policy', () => {
  it('accepts public hostnames', () => {
    expect(validateProviderUrl('https://api.openai.com/v1', { policy: 'public-only' }).ok).toBe(true);
    expect(validateProviderUrl('https://api.anthropic.com/v1', { policy: 'public-only' }).ok).toBe(true);
  });

  it('rejects loopback / private hosts unless override is set', () => {
    const r = validateProviderUrl('http://127.0.0.1/v1', { policy: 'public-only' });
    expect(r.ok).toBe(false);
    const r2 = validateProviderUrl('http://127.0.0.1/v1', {
      policy: 'public-only',
      allowLocalOverride: true,
    });
    expect(r2.ok).toBe(true);
  });

  it('rejects link-local IPv4 / IPv6 ULA / link-local IPv6 by default', () => {
    expect(validateProviderUrl('http://169.254.169.254/latest', { policy: 'public-only' }).ok).toBe(false);
    expect(validateProviderUrl('http://[fd00::1]/v1', { policy: 'public-only' }).ok).toBe(false);
    expect(validateProviderUrl('http://[fe80::1]/v1', { policy: 'public-only' }).ok).toBe(false);
  });
});

describe('validateProviderUrl: shared parsing rules', () => {
  it('rejects empty input', () => {
    expect(validateProviderUrl('', { policy: 'local-only' }).ok).toBe(false);
    expect(validateProviderUrl('   ', { policy: 'public-only' }).ok).toBe(false);
  });

  it('rejects non-http schemes under both policies', () => {
    expect(validateProviderUrl('file:///etc/passwd', { policy: 'local-only' }).ok).toBe(false);
    expect(validateProviderUrl('ftp://example.com', { policy: 'public-only' }).ok).toBe(false);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(validateProviderUrl('http://user:pass@localhost', { policy: 'local-only' }).ok).toBe(false);
    expect(validateProviderUrl('https://u:p@api.openai.com', { policy: 'public-only' }).ok).toBe(false);
  });

  it('normalizes the URL on success (lowercase host, strip trailing slash)', () => {
    const r = validateProviderUrl('http://LOCALHOST:11434/v1/', { policy: 'local-only' });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('http://localhost:11434/v1');
  });
});
