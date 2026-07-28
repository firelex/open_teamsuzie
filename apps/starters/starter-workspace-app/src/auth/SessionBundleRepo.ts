import type { Pool } from 'pg';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

export interface SessionBundle {
  sessionId: string;
  tenantId: string;
  sub: string;
  email: string;
  name: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  lastSeenAt: string;
  expiresAt: string;
  createdAt: string;
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** OAuth session bundles in Postgres. Refresh tokens are encrypted at rest. */
export class SessionBundleRepo {
  private key: Buffer;

  constructor(private pool: Pool, secret: string) {
    this.key = scryptSync(secret, 'suzie-session-bundle', 32);
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${ct.toString('base64url')}.${tag.toString('base64url')}`;
  }

  private decrypt(blob: string): string {
    const [ivB, ctB, tagB] = blob.split('.');
    const iv = Buffer.from(ivB, 'base64url');
    const ct = Buffer.from(ctB, 'base64url');
    const tag = Buffer.from(tagB, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  async create(input: { tenantId: string; sub: string; email: string; name: string; refreshToken: string; accessToken: string; accessTokenExpiresAt: string }): Promise<SessionBundle> {
    const now = new Date();
    const sessionId = randomBytes(32).toString('base64url');
    const bundle: SessionBundle = {
      sessionId,
      tenantId: input.tenantId,
      sub: input.sub, email: input.email, name: input.name,
      refreshToken: input.refreshToken,
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    };
    await this.pool.query(
      `INSERT INTO user_sessions (session_id, tenant_id, sub, email, name, refresh_token_enc, access_token, access_token_expires_at, last_seen_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [sessionId, input.tenantId, input.sub, input.email, input.name,
       this.encrypt(input.refreshToken), input.accessToken, input.accessTokenExpiresAt,
       bundle.lastSeenAt, bundle.expiresAt, bundle.createdAt],
    );
    return bundle;
  }

  async get(sessionId: string): Promise<SessionBundle | null> {
    const { rows } = await this.pool.query(`SELECT * FROM user_sessions WHERE session_id = $1`, [sessionId]);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id, tenantId: row.tenant_id, sub: row.sub, email: row.email, name: row.name,
      refreshToken: this.decrypt(row.refresh_token_enc),
      accessToken: row.access_token,
      accessTokenExpiresAt: new Date(row.access_token_expires_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async updateTokens(sessionId: string, t: { refreshToken: string; accessToken: string; accessTokenExpiresAt: string }): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions SET refresh_token_enc = $1, access_token = $2, access_token_expires_at = $3, last_seen_at = $4 WHERE session_id = $5`,
      [this.encrypt(t.refreshToken), t.accessToken, t.accessTokenExpiresAt, new Date().toISOString(), sessionId],
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE session_id = $1`, [sessionId]);
  }

  async purgeExpired(): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE expires_at < now()`);
  }
}
