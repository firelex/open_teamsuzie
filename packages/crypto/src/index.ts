/**
 * AES-256-GCM + key-hash helpers shared across Team Suzie services.
 *
 * Wire format is intentionally fixed and byte-compatible across all
 * consumers (so a payload encrypted by one service can be decrypted by
 * another sharing the same secret). DO NOT change algorithm parameters
 * (cipher, IV length, salt length, PBKDF2 iterations) without a versioned
 * envelope — silently rotating them would corrupt at-rest data.
 *
 * The combined blob layout is: `[salt(32) | iv(16) | authTag(16) | ciphertext]`,
 * base64-encoded.
 */
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

export interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
  salt: string;
}

export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encrypt(plaintext: string, secret: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'base64'),
  ]);

  return combined.toString('base64');
}

export function decrypt(encryptedData: string, secret: string): string {
  const combined = Buffer.from(encryptedData, 'base64');

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(secret, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(prefix: string = 'dtk'): {
  key: string;
  prefix: string;
  hash: string;
} {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `${prefix}_${randomBytes}`;
  const keyPrefix = key.substring(0, 12);
  const hash = hashApiKey(key);

  return { key, prefix: keyPrefix, hash };
}

export function verifyApiKey(providedKey: string, storedHash: string): boolean {
  const providedHash = hashApiKey(providedKey);
  return crypto.timingSafeEqual(
    Buffer.from(providedHash, 'hex'),
    Buffer.from(storedHash, 'hex'),
  );
}

export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Ed25519 signing for tamper-evident exports. Keys are PEM strings:
 * PKCS#8 for the private key, SPKI for the public key. A signature is
 * base64 over the exact bytes signed.
 */
export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** Public key (SPKI PEM) of an Ed25519 private key. Throws on a bad key. */
export function signingPublicKey(privateKeyPem: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`signing key must be Ed25519 (got ${key.asymmetricKeyType})`);
  }
  return crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
}

export function signBytes(data: Buffer | string, privateKeyPem: string): string {
  return crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifySignature(data: Buffer | string, signatureB64: string, publicKeyPem: string): boolean {
  return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(publicKeyPem), Buffer.from(signatureB64, 'base64'));
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) for authenticator-app two-factor sign-in: HMAC-SHA1,
// 30-second steps, 6 digits, the defaults every authenticator app uses.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random TOTP secret (160 bits), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The 6-digit code for one 30-second step counter. */
export function totpCodeAt(secretBase32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

export function totpCounter(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 30_000);
}

/**
 * Check a code against the current step and one step either side (clock
 * drift). Returns the matching step counter, or null. Callers should
 * reject a counter at or below the last one accepted, so a code cannot be
 * used twice.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number = Date.now()): number | null {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const now = totpCounter(nowMs);
  for (const counter of [now - 1, now, now + 1]) {
    const expected = totpCodeAt(secretBase32, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return counter;
  }
  return null;
}

/** otpauth:// URI that authenticator apps read from a QR code. */
export function totpUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams({ secret: opts.secret, issuer: opts.issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
