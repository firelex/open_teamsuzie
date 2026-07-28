import { Pool } from 'pg';

/**
 * Postgres is the authoritative, multi-tenant store. Every tenant-owned table
 * carries a `tenant_id` and is queried through the request-scoped tenant context
 * (see tenant.ts). The template ships the session, audit, and tenants tables;
 * the build agent adds the app's domain tables the same way (always with
 * tenant_id, never with seeded fake data).
 */
export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export async function initSchema(pool: Pool, defaultTenantId: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id              TEXT PRIMARY KEY,
      tenant_id               TEXT NOT NULL REFERENCES tenants(id),
      sub                     TEXT NOT NULL,
      email                   TEXT NOT NULL,
      name                    TEXT NOT NULL DEFAULT '',
      refresh_token_enc       TEXT NOT NULL,
      access_token            TEXT NOT NULL,
      access_token_expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at            TIMESTAMPTZ NOT NULL,
      expires_at              TIMESTAMPTZ NOT NULL,
      created_at              TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_sub ON user_sessions(tenant_id, sub);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(id),
      actor_sub   TEXT,
      action      TEXT NOT NULL,
      target      TEXT,
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
  `);

  // Seed the default tenant so the app runs before real tenant resolution is wired.
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [defaultTenantId, 'Default tenant'],
  );
}
