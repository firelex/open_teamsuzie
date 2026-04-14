import crypto from 'crypto';

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
        Buffer.from(encrypted, 'base64')
    ]);

    return combined.toString('base64');
}

export function decrypt(encryptedData: string, secret: string): string {
    const combined = Buffer.from(encryptedData, 'base64');

    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
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

export function generateApiKey(prefix: string = 'dtk'): { key: string; prefix: string; hash: string } {
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
        Buffer.from(storedHash, 'hex')
    );
}

export function generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
}
