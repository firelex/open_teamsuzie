import { describe, expect, it } from 'vitest';
import { oidcCookieKeys } from './Provider.js';

describe('oidcCookieKeys', () => {
  it('uses OIDC_COOKIE_SECRET when set', () => {
    expect(oidcCookieKeys({ NODE_ENV: 'production', OIDC_COOKIE_SECRET: 's3cret' })).toEqual(['s3cret']);
  });

  it('refuses to fall back to the public development key in production', () => {
    expect(() => oidcCookieKeys({ NODE_ENV: 'production' })).toThrow(/OIDC_COOKIE_SECRET/);
    expect(() => oidcCookieKeys({ NODE_ENV: 'production', OIDC_COOKIE_SECRET: '  ' })).toThrow(/OIDC_COOKIE_SECRET/);
  });

  it('falls back to a development key outside production', () => {
    expect(oidcCookieKeys({ NODE_ENV: 'development' })).toHaveLength(1);
  });
});
