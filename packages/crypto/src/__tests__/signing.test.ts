import { describe, expect, it } from 'vitest';
import { generateSigningKeyPair, signBytes, signingPublicKey, verifySignature } from '../index.js';

describe('Ed25519 signing', () => {
  it('signs and verifies, and rejects any change to the data', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeyPair();
    expect(signingPublicKey(privateKeyPem)).toBe(publicKeyPem);
    const manifest = JSON.stringify({ files: [{ path: 'a.docx', sha256: 'abc' }] });
    const sig = signBytes(manifest, privateKeyPem);
    expect(verifySignature(manifest, sig, publicKeyPem)).toBe(true);
    expect(verifySignature(manifest.replace('abc', 'abd'), sig, publicKeyPem)).toBe(false);
  });
});
