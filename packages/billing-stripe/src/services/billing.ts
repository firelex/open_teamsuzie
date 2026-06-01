import RedisModule from 'ioredis';
const Redis = RedisModule.default || RedisModule;
type RedisType = InstanceType<typeof Redis>;
import { type Sequelize, QueryTypes } from 'sequelize';
import { Organization, OrganizationMember } from '@teamsuzie/shared-auth';
import { OrgBilling } from '../models/org-billing.js';
import { BillingTransaction } from '../models/billing-transaction.js';

const BALANCE_KEY_PREFIX = 'billing:balance:';
const RECHARGE_LOCK_PREFIX = 'billing:recharging:';
const RECHARGE_LOCK_TTL = 60; // seconds

interface StripeLib {
    customers: {
        create(params: Record<string, unknown>): Promise<{ id: string }>;
    };
    checkout: {
        sessions: {
            create(params: Record<string, unknown>): Promise<{ id: string; url: string }>;
            retrieve(id: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
        };
    };
    paymentIntents: {
        create(params: Record<string, unknown>): Promise<{ id: string; status: string }>;
    };
    webhooks: {
        constructEvent(body: Buffer, sig: string, secret: string): Record<string, unknown>;
    };
}

export interface BillingServiceConfig {
    /** Redis URI. Used for balance caching + auto-recharge distributed lock. */
    redisUrl: string;
    /** Sequelize instance from the host app's SequelizeService. */
    sequelize: Sequelize;
    /** Stripe API key. Required at construct time; checkout calls throw without it. */
    stripeSecretKey: string;
    /** Webhook signing secret. Required before `constructWebhookEvent` works. */
    stripeWebhookSecret: string;
    /** USD amount of the initial top-up checkout (signup flow). Default $20. */
    initialCreditsUsd?: number;
    /** USD amount of subsequent top-up checkouts and auto-recharges. Default $20. */
    topUpAmountUsd?: number;
    /** Balance below which auto-recharge is triggered (USD). Default $5. */
    lowBalanceThresholdUsd?: number;
}

/**
 * Stripe credit-balance billing. Each org has an `OrgBilling` row tracking
 * `credit_balance` (USD) plus refs to the Stripe customer + saved payment
 * method. Cost-incurring host code calls `deductCredits()`; when balance dips
 * below `lowBalanceThresholdUsd` and auto-recharge is enabled, an off-session
 * `paymentIntents.create` tops it back up by `topUpAmountUsd`.
 *
 * The host app supplies a `Sequelize` instance (so this service participates
 * in the host's schema-sync / migration story) and the Stripe credentials.
 * Stripe is lazy-loaded on first use — `STRIPE_SECRET_KEY` missing at boot
 * isn't fatal; it's only fatal at the moment a Stripe call is made.
 */
export class BillingService {

    private redis: RedisType;
    private sequelize: Sequelize;
    private stripe: StripeLib | null = null;
    private stripeSecretKey: string;
    private stripeWebhookSecret: string;
    private initialCreditsUsd: number;
    private topUpAmountUsd: number;
    private lowBalanceThresholdUsd: number;

    constructor(config: BillingServiceConfig) {
        this.redis = new Redis(config.redisUrl);
        this.sequelize = config.sequelize;
        this.stripeSecretKey = config.stripeSecretKey;
        this.stripeWebhookSecret = config.stripeWebhookSecret;
        this.initialCreditsUsd = config.initialCreditsUsd ?? 20;
        this.topUpAmountUsd = config.topUpAmountUsd ?? 20;
        this.lowBalanceThresholdUsd = config.lowBalanceThresholdUsd ?? 5;
        // Eagerly warm up the Stripe client so the webhook handler doesn't
        // throw "Stripe not initialized — webhook called before any Stripe
        // call". The webhook can land before any other Stripe API call has
        // happened, and constructWebhookEvent is sync (can't await getStripe).
        if (this.stripeSecretKey) {
            this.getStripe().catch((err) => {
                console.error('[billing-stripe] eager Stripe init failed:', err?.message ?? err);
            });
        }
    }

    private async getStripe(): Promise<StripeLib> {
        if (!this.stripe) {
            if (!this.stripeSecretKey) {
                throw new Error('STRIPE_SECRET_KEY not configured');
            }
            const StripeModule = await import('stripe');
            const StripeClass = (StripeModule as unknown as { default: new (k: string) => StripeLib }).default
                || (StripeModule as unknown as new (k: string) => StripeLib);
            this.stripe = new (StripeClass as new (k: string) => StripeLib)(this.stripeSecretKey);
        }
        return this.stripe;
    }

    // ── Balance cache ────────────────────────────────────────────────────────

    async getCachedBalance(orgId: string): Promise<number | null> {
        const val = await this.redis.get(`${BALANCE_KEY_PREFIX}${orgId}`);
        return val !== null ? parseFloat(val) : null;
    }

    private async setCachedBalance(orgId: string, balance: number): Promise<void> {
        await this.redis.set(`${BALANCE_KEY_PREFIX}${orgId}`, balance.toString());
    }

    async hydrateBalanceCache(orgId: string): Promise<number> {
        const billing = await OrgBilling.findOne({ where: { org_id: orgId } });
        const balance = billing ? parseFloat(String(billing.credit_balance)) : 0;
        await this.setCachedBalance(orgId, balance);
        return balance;
    }

    // ── Credit deduction (called from cost-incurring host code) ─────────────

    /**
     * Atomic balance debit. Uses `SELECT … FOR UPDATE` so concurrent calls
     * (e.g. two chat turns racing) don't go below zero or skip a transaction
     * record. No-op for orgs with no `OrgBilling` row (treated as exempt
     * until billing is set up). Triggers auto-recharge fire-and-forget when
     * the new balance is below threshold.
     */
    async deductCredits(orgId: string, amount: number): Promise<void> {
        if (amount <= 0) return;

        const t = await this.sequelize.transaction();
        try {
            const rows = await this.sequelize.query<{ credit_balance: string }>(
                `SELECT credit_balance FROM org_billing WHERE org_id = $1 FOR UPDATE`,
                { bind: [orgId], type: QueryTypes.SELECT, transaction: t },
            );

            if (rows.length === 0) {
                await t.commit();
                return;
            }

            const currentBalance = parseFloat(rows[0].credit_balance);
            const newBalance = Math.max(0, currentBalance - amount);

            await this.sequelize.query(
                `UPDATE org_billing SET credit_balance = $1, updated_at = NOW() WHERE org_id = $2`,
                { bind: [newBalance, orgId], transaction: t },
            );

            await this.sequelize.query(
                `INSERT INTO billing_transaction (id, org_id, type, amount, balance_after, description, created_at)
                 VALUES (gen_random_uuid(), $1, 'deduction', $2, $3, $4, NOW())`,
                {
                    bind: [orgId, -amount, newBalance, 'Usage deduction'],
                    transaction: t,
                },
            );

            await t.commit();
            await this.setCachedBalance(orgId, newBalance);

            if (newBalance < this.lowBalanceThresholdUsd) {
                const billing = await OrgBilling.findOne({ where: { org_id: orgId } });
                if (billing?.auto_recharge && billing.stripe_payment_method_id) {
                    this.triggerAutoRecharge(orgId).catch((err) => {
                        console.error(`[billing-stripe] Auto-recharge failed for org ${orgId}:`, err.message);
                    });
                }
            }
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    // ── Auto-recharge ────────────────────────────────────────────────────────

    async triggerAutoRecharge(orgId: string): Promise<void> {
        // Distributed lock so two near-simultaneous deductions don't both
        // initiate a recharge. NX + EX is atomic.
        const lockKey = `${RECHARGE_LOCK_PREFIX}${orgId}`;
        const acquired = await this.redis.set(lockKey, '1', 'EX', RECHARGE_LOCK_TTL, 'NX');
        if (!acquired) {
            return;
        }

        try {
            const billing = await OrgBilling.findOne({ where: { org_id: orgId } });
            if (!billing || !billing.auto_recharge || !billing.stripe_payment_method_id) {
                return;
            }

            // Double-check — a concurrent webhook may have already topped up.
            const currentBalance = parseFloat(String(billing.credit_balance));
            if (currentBalance >= this.lowBalanceThresholdUsd) {
                return;
            }

            const stripe = await this.getStripe();
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(this.topUpAmountUsd * 100),
                currency: 'usd',
                customer: billing.stripe_customer_id,
                payment_method: billing.stripe_payment_method_id,
                off_session: true,
                confirm: true,
                metadata: {
                    org_id: orgId,
                    type: 'auto_recharge',
                },
            });

            console.log(`[billing-stripe] Auto-recharge initiated for org ${orgId}: ${paymentIntent.id} (${paymentIntent.status})`);
        } finally {
            await this.redis.del(lockKey);
        }
    }

    // ── Stripe Checkout (signup + manual top-up) ────────────────────────────

    /**
     * Create-or-reuse the user's personal org, ensure an `OrgBilling` row
     * exists with a Stripe customer, and return a Checkout Session URL for
     * the initial credit purchase. `payment_intent_data.setup_future_usage`
     * is set to `off_session` so subsequent auto-recharges can run without
     * the user being present.
     */
    async createBillingSetup(
        userId: string,
        userName: string,
        userEmail: string,
        successUrl: string,
        cancelUrl: string,
    ): Promise<{ checkout_url: string; org_id: string }> {
        const orgId = await this.findOrCreatePersonalOrg(userId, userName);

        let billing = await OrgBilling.findOne({ where: { org_id: orgId } });
        const stripe = await this.getStripe();

        if (!billing) {
            const customer = await stripe.customers.create({
                email: userEmail,
                metadata: { org_id: orgId, user_id: userId },
            });
            billing = await OrgBilling.create({
                org_id: orgId,
                stripe_customer_id: customer.id,
                billing_status: 'pending',
            });
        } else if (!billing.stripe_customer_id) {
            const customer = await stripe.customers.create({
                email: userEmail,
                metadata: { org_id: orgId, user_id: userId },
            });
            await billing.update({ stripe_customer_id: customer.id });
        }

        const session = await stripe.checkout.sessions.create({
            customer: billing.stripe_customer_id,
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'AI Credits Top-Up',
                        description: `$${this.initialCreditsUsd} in AI usage credits`,
                    },
                    unit_amount: Math.round(this.initialCreditsUsd * 100),
                },
                quantity: 1,
            }],
            payment_intent_data: {
                setup_future_usage: 'off_session',
                metadata: { org_id: orgId, type: 'initial' },
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { org_id: orgId, type: 'initial' },
        });

        return { checkout_url: session.url, org_id: orgId };
    }

    /** Manual top-up — same flow as setup but assumes billing already exists. */
    async createTopUpSession(
        orgId: string,
        successUrl: string,
        cancelUrl: string,
    ): Promise<{ checkout_url: string }> {
        const billing = await OrgBilling.findOne({ where: { org_id: orgId } });
        if (!billing || !billing.stripe_customer_id) {
            throw new Error('Billing not set up for this organization');
        }

        const stripe = await this.getStripe();
        const session = await stripe.checkout.sessions.create({
            customer: billing.stripe_customer_id,
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'AI Credits Top-Up',
                        description: `$${this.topUpAmountUsd} in AI usage credits`,
                    },
                    unit_amount: Math.round(this.topUpAmountUsd * 100),
                },
                quantity: 1,
            }],
            payment_intent_data: {
                setup_future_usage: 'off_session',
                metadata: { org_id: orgId, type: 'topup' },
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { org_id: orgId, type: 'topup' },
        });

        return { checkout_url: session.url };
    }

    // ── Webhook processing ───────────────────────────────────────────────────

    constructWebhookEvent(rawBody: Buffer, signature: string): Record<string, unknown> {
        if (!this.stripeWebhookSecret) {
            throw new Error('STRIPE_WEBHOOK_SECRET not configured');
        }
        if (!this.stripe) {
            throw new Error('Stripe not initialized — webhook called before any Stripe call');
        }
        return this.stripe.webhooks.constructEvent(rawBody, signature, this.stripeWebhookSecret);
    }

    /**
     * Handle `checkout.session.completed` — credit the org by the
     * checkout amount, mark billing active, and persist the payment method
     * for future auto-recharge.
     */
    async processCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
        const orgId = (session.metadata as Record<string, string> | undefined)?.org_id;
        if (!orgId) return;

        const billing = await OrgBilling.findOne({ where: { org_id: orgId } });
        if (!billing) return;

        const stripe = await this.getStripe();
        const fullSession = await stripe.checkout.sessions.retrieve(
            session.id as string,
            { expand: ['payment_intent.payment_method'] },
        );
        const paymentIntent = fullSession.payment_intent as Record<string, unknown> | null;
        const paymentMethodRaw = paymentIntent?.payment_method;
        const paymentMethodId = typeof paymentMethodRaw === 'string'
            ? paymentMethodRaw
            : (paymentMethodRaw as Record<string, unknown> | undefined)?.id as string | undefined;
        const amount = ((session.amount_total as number | undefined) ?? 0) / 100;

        const t = await this.sequelize.transaction();
        try {
            // Idempotency: a Stripe-delivered webhook can be retried (network
            // blips, manual replays). If we've already credited this session,
            // skip silently and return 200 so Stripe stops retrying. The
            // SELECT runs inside the same transaction as the row lock below
            // so a concurrent retry waits on the FOR UPDATE and sees our
            // committed row.
            const existing = await this.sequelize.query<{ id: string }>(
                `SELECT id FROM billing_transaction WHERE stripe_checkout_session_id = $1 LIMIT 1`,
                { bind: [session.id as string], type: QueryTypes.SELECT, transaction: t },
            );
            if (existing.length > 0) {
                await t.commit();
                console.log(`[billing-stripe] Checkout already processed: session=${session.id}`);
                return;
            }

            const rows = await this.sequelize.query<{ credit_balance: string }>(
                `SELECT credit_balance FROM org_billing WHERE org_id = $1 FOR UPDATE`,
                { bind: [orgId], type: QueryTypes.SELECT, transaction: t },
            );
            const currentBalance = rows.length > 0 ? parseFloat(rows[0].credit_balance) : 0;
            const newBalance = currentBalance + amount;

            await this.sequelize.query(
                `UPDATE org_billing
                 SET credit_balance = $1,
                     billing_status = 'active',
                     stripe_payment_method_id = COALESCE($2, stripe_payment_method_id),
                     updated_at = NOW()
                 WHERE org_id = $3`,
                { bind: [newBalance, paymentMethodId || null, orgId], transaction: t },
            );

            await this.sequelize.query(
                `INSERT INTO billing_transaction (id, org_id, type, amount, balance_after, description, stripe_checkout_session_id, created_at)
                 VALUES (gen_random_uuid(), $1, 'initial', $2, $3, $4, $5, NOW())`,
                {
                    bind: [orgId, amount, newBalance, `Initial credit: $${amount}`, session.id],
                    transaction: t,
                },
            );

            await t.commit();
            await this.setCachedBalance(orgId, newBalance);
            console.log(`[billing-stripe] Checkout completed: org=${orgId} credited=$${amount} balance=$${newBalance}`);
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Handle `payment_intent.succeeded`. Skips `type=initial` intents because
     * those are handled by `processCheckoutCompleted` (the checkout flow
     * includes the payment intent inside the session). Used for top-ups and
     * auto-recharges.
     */
    async processPaymentSucceeded(paymentIntent: Record<string, unknown>): Promise<void> {
        const metadata = paymentIntent.metadata as Record<string, string> | undefined;
        const orgId = metadata?.org_id;
        if (!orgId) return;
        if (metadata?.type === 'initial') return;

        const amount = ((paymentIntent.amount as number | undefined) ?? 0) / 100;
        if (amount <= 0) return;

        const t = await this.sequelize.transaction();
        try {
            // Idempotency check — see processCheckoutCompleted for rationale.
            const existing = await this.sequelize.query<{ id: string }>(
                `SELECT id FROM billing_transaction WHERE stripe_payment_intent_id = $1 LIMIT 1`,
                { bind: [paymentIntent.id as string], type: QueryTypes.SELECT, transaction: t },
            );
            if (existing.length > 0) {
                await t.commit();
                console.log(`[billing-stripe] Payment intent already processed: pi=${paymentIntent.id}`);
                return;
            }

            const rows = await this.sequelize.query<{ credit_balance: string }>(
                `SELECT credit_balance FROM org_billing WHERE org_id = $1 FOR UPDATE`,
                { bind: [orgId], type: QueryTypes.SELECT, transaction: t },
            );
            if (rows.length === 0) {
                await t.commit();
                return;
            }

            const currentBalance = parseFloat(rows[0].credit_balance);
            const newBalance = currentBalance + amount;

            await this.sequelize.query(
                `UPDATE org_billing SET credit_balance = $1, updated_at = NOW() WHERE org_id = $2`,
                { bind: [newBalance, orgId], transaction: t },
            );

            const pmId = typeof paymentIntent.payment_method === 'string'
                ? paymentIntent.payment_method
                : null;
            if (pmId) {
                await this.sequelize.query(
                    `UPDATE org_billing SET stripe_payment_method_id = $1 WHERE org_id = $2`,
                    { bind: [pmId, orgId], transaction: t },
                );
            }

            await this.sequelize.query(
                `INSERT INTO billing_transaction (id, org_id, type, amount, balance_after, description, stripe_payment_intent_id, created_at)
                 VALUES (gen_random_uuid(), $1, 'topup', $2, $3, $4, $5, NOW())`,
                {
                    bind: [orgId, amount, newBalance, `Top-up: $${amount}`, paymentIntent.id],
                    transaction: t,
                },
            );

            await t.commit();
            await this.setCachedBalance(orgId, newBalance);
            console.log(`[billing-stripe] Payment succeeded: org=${orgId} credited=$${amount} balance=$${newBalance}`);
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    async processPaymentFailed(paymentIntent: Record<string, unknown>): Promise<void> {
        const metadata = paymentIntent.metadata as Record<string, string> | undefined;
        const orgId = metadata?.org_id;
        if (!orgId) return;
        console.error(`[billing-stripe] Payment failed: org=${orgId} pi=${paymentIntent.id}`);
    }

    // ── Query methods ────────────────────────────────────────────────────────

    async getBillingStatus(orgId: string): Promise<{
        credit_balance: number;
        auto_recharge: boolean;
        billing_status: string;
        has_payment_method: boolean;
    } | null> {
        const billing = await OrgBilling.findOne({ where: { org_id: orgId } });
        if (!billing) return null;
        return {
            credit_balance: parseFloat(String(billing.credit_balance)),
            auto_recharge: billing.auto_recharge,
            billing_status: billing.billing_status,
            has_payment_method: !!billing.stripe_payment_method_id,
        };
    }

    async getTransactions(
        orgId: string,
        page = 1,
        limit = 50,
    ): Promise<{ transactions: BillingTransaction[]; total: number }> {
        const offset = (page - 1) * limit;
        const { count, rows } = await BillingTransaction.findAndCountAll({
            where: { org_id: orgId },
            order: [['created_at', 'DESC']],
            limit,
            offset,
        });
        return { transactions: rows, total: count };
    }

    async setAutoRecharge(orgId: string, enabled: boolean): Promise<void> {
        await OrgBilling.update({ auto_recharge: enabled }, { where: { org_id: orgId } });
    }

    // ── Resolve a user's billable org ────────────────────────────────────────

    /**
     * Find the user's primary org, or create a personal one. Mirrors the
     * shape `shared-auth`'s AuthController.ensureHumanWorkspace would, but
     * is callable from any code path that doesn't go through the login
     * controller (e.g. a billing-setup flow that runs after registration).
     */
    async findOrCreatePersonalOrg(userId: string, userName: string): Promise<string> {
        const membership = await OrganizationMember.findOne({
            where: { user_id: userId },
            order: [['created_at', 'ASC']],
        });
        if (membership) {
            return membership.organization_id;
        }

        const org = await Organization.create({
            name: `${userName}'s Workspace`,
            slug: `personal-${userId.slice(0, 8)}`,
            type: 'human',
            owner_id: userId,
            settings: {},
            created_by: userId,
            updated_by: userId,
        });
        await OrganizationMember.create({
            organization_id: org.id,
            user_id: userId,
            role: 'owner',
            created_by: userId,
            updated_by: userId,
        });
        return org.id;
    }

    async close(): Promise<void> {
        await this.redis.quit();
    }
}
