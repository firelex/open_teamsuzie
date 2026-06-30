import type { Pool } from 'pg';
import { currentTenantId } from './tenant.ts';

export interface AuditEntry {
  actorSub?: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tenant-scoped audit trail. Every governed side-effect should `record()` here.
 * Writes to the Postgres audit_log table, tagged with the current tenant. (The
 * in-memory EventBus handles live pub/sub; this is the durable governance log.)
 */
export class AuditLog {
  constructor(private pool: Pool) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (tenant_id, actor_sub, action, target, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [currentTenantId(), entry.actorSub ?? null, entry.action, entry.target ?? null, JSON.stringify(entry.metadata ?? {})],
    );
  }
}
