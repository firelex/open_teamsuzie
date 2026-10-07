# @teamsuzie/crypto

Zero-dependency AES-256-GCM encryption and API-key hashing helpers shared across Team Suzie services.

Use it when a service needs to encrypt secrets at rest or hash/verify API keys, and needs the exact same byte-compatible wire format as other Team Suzie services sharing the same secret (so one service can decrypt what another encrypted).

```ts
import {
  encrypt,
  decrypt,
  generateApiKey,
  verifyApiKey,
  generateSecureToken,
} from '@teamsuzie/crypto';

const secret = process.env.MASTER_KEY!;

const blob = encrypt('super secret value', secret);
const plaintext = decrypt(blob, secret);

const { key, prefix, hash } = generateApiKey('dtk');
// store `hash` and `prefix`; hand `key` to the caller once
const ok = verifyApiKey(key, hash); // true

const sessionToken = generateSecureToken(); // 32 random bytes, hex-encoded
```

## Main exports

- `encrypt(plaintext, secret)` / `decrypt(encryptedData, secret)` — AES-256-GCM round trip. Each call derives a fresh key from `secret` via PBKDF2 with a random salt.
- `deriveKey(password, salt)` — the PBKDF2 key derivation used internally; exposed for callers that need to match it directly.
- `hashApiKey(apiKey)` — SHA-256 hex digest.
- `generateApiKey(prefix?)` — returns `{ key, prefix, hash }`; `prefix` defaults to `'dtk'` and the returned `prefix` field is the key's first 12 characters (for display/lookup), not the input prefix alone.
- `verifyApiKey(providedKey, storedHash)` — timing-safe comparison of `hashApiKey(providedKey)` against a stored hash.
- `generateSecureToken(length?)` — random hex token, `length` random bytes (default 32).

## Wire format

`encrypt` returns a base64 string laid out as `[salt(32) | iv(16) | authTag(16) | ciphertext]`. This layout, the cipher (`aes-256-gcm`), and the PBKDF2 iteration count (100,000) are fixed and must not change without a versioned envelope — rotating them silently would make existing encrypted data undecryptable.

## Used by

`@teamsuzie/model-settings` and `@teamsuzie/shared-auth` both depend on this package for encrypting stored credentials.
