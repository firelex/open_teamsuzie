import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, totpCodeAt, totpUri, verifyTotp } from '../index.js';

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890"; 8-digit values mod 10^6.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpCodeAt(SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpCodeAt(SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCodeAt(SECRET, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpCodeAt(SECRET, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts the current and adjacent steps only, and returns the step', () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(SECRET, totpCodeAt(SECRET, step), now)).toBe(step);
    expect(verifyTotp(SECRET, totpCodeAt(SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpCodeAt(SECRET, step - 2), now)).toBeNull();
    expect(verifyTotp(SECRET, '12345', now)).toBeNull();
  });

  it('round-trips base32 and builds an authenticator URI', () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(totpUri({ secret, account: 'a@x.com', issuer: 'Suzie Law' })).toMatch(/^otpauth:\/\/totp\/Suzie%20Law%3Aa%40x\.com\?secret=/);
  });
});
