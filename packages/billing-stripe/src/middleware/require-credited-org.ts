import type { Request, RequestHandler } from 'express';
import { Organization, OrganizationMember, User } from '@teamsuzie/shared-auth';
import type { BillingService } from '../services/billing.js';

export interface RequireCreditedOrgOptions {
    service: BillingService;
    /**
     * Override the default org-id resolution if the host app already knows
     * which org owns the request (e.g. a route-scoped middleware that
     * resolved a matter → org mapping). When omitted, falls back to the
     * user's default org or earliest membership.
     */
    resolveOrgId?: (req: Request) => string | null | Promise<string | null>;
    /**
     * Minimum balance (USD) needed to pass. Default 0.01 — any positive
     * balance lets the call through. Set higher if you want a buffer.
     */
    minBalanceUsd?: number;
}

interface AuthSession {
    userId?: string;
}

async function defaultResolveOrgId(req: Request): Promise<string | null> {
    const session = req.session as AuthSession | undefined;
    const userId = session?.userId;
    if (!userId) return null;

    const user = await User.findByPk(userId, {
        attributes: ['id', 'default_organization_id'],
    });
    if (user?.default_organization_id) return user.default_organization_id;

    const memberships = await OrganizationMember.findAll({
        where: { user_id: userId },
        order: [['created_at', 'ASC']],
    });
    if (memberships.length === 0) return null;
    const orgIds = memberships.map((m) => m.organization_id);
    const orgs = await Organization.findAll({ where: { id: orgIds } });
    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const human = memberships.find((m) => orgMap.get(m.organization_id)?.type === 'human');
    return human?.organization_id ?? memberships[0]?.organization_id ?? null;
}

/**
 * Paywall middleware for cost-incurring routes. Returns HTTP 402 (Payment
 * Required) with `{ error: 'payment_required', billing: { … } }` when the
 * caller's org has no positive credit balance. Pairs with the host app's
 * client code, which should redirect 402 responses to a checkout page that
 * calls `POST /api/billing/setup`.
 *
 * Stashes the resolved org id at `req._billingOrgId` so downstream handlers
 * (e.g. the chat turn that will later call `deductCredits`) can read it
 * without resolving again.
 */
export function createRequireCreditedOrg(opts: RequireCreditedOrgOptions): RequestHandler {
    const minBalance = opts.minBalanceUsd ?? 0.01;
    const resolve = opts.resolveOrgId ?? defaultResolveOrgId;

    return async (req, res, next) => {
        try {
            const orgId = await resolve(req);
            if (!orgId) {
                res.status(402).json({
                    error: 'payment_required',
                    reason: 'no_org',
                    message: 'No organization associated with this account. Set up billing first.',
                });
                return;
            }

            const status = await opts.service.getBillingStatus(orgId);
            if (!status || status.billing_status === 'suspended') {
                res.status(402).json({
                    error: 'payment_required',
                    reason: 'no_billing',
                    org_id: orgId,
                    message: 'Billing not set up — call POST /api/billing/setup to add credits.',
                });
                return;
            }

            if (status.billing_status !== 'exempt' && status.credit_balance < minBalance) {
                res.status(402).json({
                    error: 'payment_required',
                    reason: 'insufficient_credits',
                    org_id: orgId,
                    billing: status,
                    message: 'Credit balance exhausted. Top up to continue.',
                });
                return;
            }

            (req as Request & { _billingOrgId?: string })._billingOrgId = orgId;
            next();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[billing-stripe] requireCreditedOrg error:', message);
            res.status(500).json({ error: 'billing_check_failed', message });
        }
    };
}
