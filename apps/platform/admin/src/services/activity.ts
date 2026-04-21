import { Agent, AuditLog, User } from '@teamsuzie/shared-auth';
import { Op } from 'sequelize';

export type ActorTypeFilter = 'user' | 'agent' | 'system';

export interface ActivityFilters {
  /** Match rows whose action starts with this prefix — e.g. "approval." or "config." */
  actionPrefix?: string;
  resourceType?: string;
  actorType?: ActorTypeFilter;
  actorId?: string;
  /** ISO date string — inclusive lower bound. */
  since?: string;
  /** ISO date string — inclusive upper bound. */
  until?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityRow {
  id: string;
  timestamp: Date;
  actor_type: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
}

export interface ActiveAgentRow {
  id: string;
  name: string;
  last_active_at: Date | null;
  status: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ActivityService {
  async list(
    organizationId: string | null,
    filters: ActivityFilters,
  ): Promise<{ items: ActivityRow[]; total: number }> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = filters.offset ?? 0;

    const where: Record<string, unknown> = {};
    if (filters.actionPrefix) {
      where.action = { [Op.like]: `${filters.actionPrefix}%` };
    }
    if (filters.resourceType) where.resource_type = filters.resourceType;
    if (filters.actorType) where.actor_type = filters.actorType;
    if (filters.actorId) where.actor_id = filters.actorId;
    if (filters.since || filters.until) {
      const ts: Record<string | symbol, unknown> = {};
      if (filters.since) ts[Op.gte] = new Date(filters.since);
      if (filters.until) ts[Op.lte] = new Date(filters.until);
      where.timestamp = ts;
    }

    const [rows, total] = await Promise.all([
      AuditLog.findAll({
        where,
        order: [['timestamp', 'DESC']],
        limit,
        offset,
      }),
      AuditLog.count({ where }),
    ]);

    const actorIds = Array.from(
      new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v)),
    );
    const users = await User.findAll({
      where: { id: actorIds },
      attributes: ['id', 'email', 'name'],
    });
    const agents = await Agent.findAll({
      where: { id: actorIds, ...(organizationId ? { organization_id: organizationId } : {}) },
      attributes: ['id', 'name'],
    });
    const userById = new Map(users.map((u) => [u.id, `${u.email}`]));
    const agentById = new Map(agents.map((a) => [a.id, a.name]));

    const items: ActivityRow[] = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      actor_type: r.actor_type,
      actor_id: r.actor_id,
      actor_label:
        r.actor_id == null
          ? null
          : r.actor_type === 'agent'
            ? (agentById.get(r.actor_id) ?? null)
            : (userById.get(r.actor_id) ?? null),
      action: r.action,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      details: (r.details ?? null) as Record<string, unknown> | null,
    }));

    return { items, total };
  }

  async recentlyActiveAgents(
    organizationId: string,
    limit = 5,
  ): Promise<ActiveAgentRow[]> {
    const agents = await Agent.findAll({
      where: {
        organization_id: organizationId,
        last_active_at: { [Op.ne]: null },
      },
      order: [['last_active_at', 'DESC']],
      limit,
      attributes: ['id', 'name', 'last_active_at', 'status'],
    });
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      last_active_at: a.last_active_at,
      status: a.status,
    }));
  }
}
