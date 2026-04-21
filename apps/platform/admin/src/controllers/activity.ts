import type { Request, Response } from 'express';
import { getRequestActor } from '@teamsuzie/shared-auth';
import { getSession } from '../middleware/auth.js';
import { ActivityService, type ActorTypeFilter } from '../services/activity.js';
import { AgentsService } from './../services/agents.js';

const VALID_ACTOR_TYPES: ReadonlyArray<ActorTypeFilter> = ['user', 'agent', 'system'];

export class ActivityController {
  private readonly agentsService = new AgentsService();

  constructor(private readonly service: ActivityService) {}

  private logOk(req: Request, action: string, extra = ''): void {
    const actor = getRequestActor(req);
    console.log(
      `[admin.activity.${action}] ok actor=${actor.type}:${actor.userId ?? '-'} org=${actor.orgId ?? '-'} req=${actor.requestId ?? '-'}${extra ? ' ' + extra : ''}`,
    );
  }

  private logFail(req: Request, action: string, err: unknown, extra = ''): void {
    const actor = getRequestActor(req);
    console.error(
      `[admin.activity.${action}] fail actor=${actor.type}:${actor.userId ?? '-'} org=${actor.orgId ?? '-'} req=${actor.requestId ?? '-'}${extra ? ' ' + extra : ''} err=${err instanceof Error ? err.message : String(err)}`,
    );
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const session = getSession(req);
    try {
      const orgId = await this.agentsService.resolveOrgId(session.userId!);

      const rawActorType = req.query.actor_type;
      const actorType =
        typeof rawActorType === 'string' && VALID_ACTOR_TYPES.includes(rawActorType as ActorTypeFilter)
          ? (rawActorType as ActorTypeFilter)
          : undefined;

      const actionPrefix = typeof req.query.action_prefix === 'string' ? req.query.action_prefix : undefined;
      const resourceType = typeof req.query.resource_type === 'string' ? req.query.resource_type : undefined;
      const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : undefined;
      const since = typeof req.query.since === 'string' ? req.query.since : undefined;
      const until = typeof req.query.until === 'string' ? req.query.until : undefined;

      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const offsetRaw = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;
      const limit = Number.isFinite(limitRaw) && limitRaw! > 0 ? Math.floor(limitRaw!) : undefined;
      const offset = Number.isFinite(offsetRaw) && offsetRaw! >= 0 ? Math.floor(offsetRaw!) : undefined;

      const result = await this.service.list(orgId, {
        actionPrefix,
        resourceType,
        actorType,
        actorId,
        since,
        until,
        limit,
        offset,
      });

      this.logOk(
        req,
        'list',
        `count=${result.items.length} total=${result.total}${actionPrefix ? ` prefix=${actionPrefix}` : ''}`,
      );
      res.json(result);
    } catch (err) {
      this.logFail(req, 'list', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list activity' });
    }
  };

  recentlyActive = async (req: Request, res: Response): Promise<void> => {
    const session = getSession(req);
    try {
      const orgId = await this.agentsService.resolveOrgId(session.userId!);
      if (!orgId) {
        res.json({ items: [] });
        return;
      }

      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const limit = Number.isFinite(limitRaw) && limitRaw! > 0 ? Math.min(Math.floor(limitRaw!), 20) : 5;

      const items = await this.service.recentlyActiveAgents(orgId, limit);
      this.logOk(req, 'recentlyActive', `count=${items.length}`);
      res.json({ items });
    } catch (err) {
      this.logFail(req, 'recentlyActive', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list recent agents' });
    }
  };
}
