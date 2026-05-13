import type { Request, Response } from 'express';
import { Organization, OrganizationMember, User } from '@teamsuzie/shared-auth';
import type { BillingService } from '../services/billing.js';

/**
 * Shape of `req.session` after `@teamsuzie/shared-auth`'s AuthController.login
 * has run. The controllers only need `userId`; everything else (email, name)
 * is looked up via the `User` model so we don't drift if the session shape
 * changes.
 */
interface AuthSession {
    userId?: string;
}

export class BillingController {

    private billingService: BillingService;

    constructor(billingService: BillingService) {
        this.billingService = billingService;
    }

    /**
     * Resolve the user's billable org id. Prefers `default_organization_id`,
     * falls back to the earliest `OrganizationMember` row, preferring `type
     * = 'human'` orgs (skips agent-type orgs the user may also be in).
     */
    private async getUserOrgId(userId: string): Promise<string | null> {
        const user = await User.findByPk(userId, {
            attributes: ['id', 'default_organization_id'],
        });
        if (user?.default_organization_id) {
            return user.default_organization_id;
        }

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

    private getUserId(req: Request): string | null {
        const session = req.session as AuthSession | undefined;
        return session?.userId ?? null;
    }

    /** POST /setup — create personal org if missing, return Stripe Checkout URL. */
    setup = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = this.getUserId(req);
            if (!userId) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { success_url, cancel_url } = req.body ?? {};
            if (!success_url || !cancel_url) {
                res.status(400).json({ error: 'success_url and cancel_url are required' });
                return;
            }

            const user = await User.findByPk(userId);
            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            const result = await this.billingService.createBillingSetup(
                userId,
                user.name || user.email,
                user.email,
                String(success_url),
                String(cancel_url),
            );
            res.json(result);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[billing-stripe] setup error:', message);
            res.status(500).json({ error: 'Failed to create billing setup', message });
        }
    };

    /** GET /status — current credit balance + auto-recharge flag. */
    status = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = this.getUserId(req);
            if (!userId) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const orgId = await this.getUserOrgId(userId);
            if (!orgId) {
                res.json({ billing: null, org_id: null });
                return;
            }
            const status = await this.billingService.getBillingStatus(orgId);
            res.json({ billing: status, org_id: orgId });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[billing-stripe] status error:', message);
            res.status(500).json({ error: 'Failed to fetch billing status', message });
        }
    };

    /** POST /topup — Checkout session for an explicit top-up purchase. */
    topup = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = this.getUserId(req);
            if (!userId) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { success_url, cancel_url } = req.body ?? {};
            if (!success_url || !cancel_url) {
                res.status(400).json({ error: 'success_url and cancel_url are required' });
                return;
            }
            const orgId = await this.getUserOrgId(userId);
            if (!orgId) {
                res.status(400).json({ error: 'No organization found. Complete billing setup first.' });
                return;
            }
            const result = await this.billingService.createTopUpSession(
                orgId,
                String(success_url),
                String(cancel_url),
            );
            res.json(result);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[billing-stripe] topup error:', message);
            res.status(500).json({ error: 'Failed to create top-up session', message });
        }
    };

    /** PUT /auto-recharge — flip auto_recharge on/off. */
    setAutoRecharge = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = this.getUserId(req);
            if (!userId) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { enabled } = req.body ?? {};
            if (typeof enabled !== 'boolean') {
                res.status(400).json({ error: '"enabled" boolean field is required' });
                return;
            }
            const orgId = await this.getUserOrgId(userId);
            if (!orgId) {
                res.status(400).json({ error: 'No organization found' });
                return;
            }
            await this.billingService.setAutoRecharge(orgId, enabled);
            res.json({ ok: true, auto_recharge: enabled });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[billing-stripe] setAutoRecharge error:', message);
            res.status(500).json({ error: 'Failed to update auto-recharge', message });
        }
    };

    /** GET /transactions — paginated ledger view. */
    transactions = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = this.getUserId(req);
            if (!userId) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const orgId = await this.getUserOrgId(userId);
            if (!orgId) {
                res.json({ transactions: [], total: 0 });
                return;
            }
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 50;
            const result = await this.billingService.getTransactions(orgId, page, limit);
            res.json(result);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[billing-stripe] transactions error:', message);
            res.status(500).json({ error: 'Failed to fetch transactions', message });
        }
    };
}
