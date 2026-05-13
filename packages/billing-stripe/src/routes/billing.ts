import express, { Router, type RequestHandler } from 'express';
import { BillingController } from '../controllers/billing.js';
import { BillingWebhookController } from '../controllers/billing-webhook.js';
import type { BillingService } from '../services/billing.js';

export interface BillingRouterOptions {
    service: BillingService;
    /**
     * Auth middleware from the host app — usually shared-auth's session
     * guard. Applied to every route except the webhook (which is signed by
     * Stripe and verified separately).
     */
    requireAuth: RequestHandler;
}

/**
 * Mount under any prefix; produces `/setup`, `/status`, `/topup`,
 * `/auto-recharge`, `/transactions`.
 *
 * The webhook is *not* here — it needs `express.raw()` body parsing instead
 * of `express.json()`. Use `createBillingWebhookRouter` for that and mount
 * it before your global JSON parser.
 */
export function createBillingRouter(opts: BillingRouterOptions): Router {
    const router = Router();
    const controller = new BillingController(opts.service);

    router.post('/setup', opts.requireAuth, controller.setup);
    router.get('/status', opts.requireAuth, controller.status);
    router.post('/topup', opts.requireAuth, controller.topup);
    router.put('/auto-recharge', opts.requireAuth, controller.setAutoRecharge);
    router.get('/transactions', opts.requireAuth, controller.transactions);

    return router;
}

export interface BillingWebhookRouterOptions {
    service: BillingService;
}

/**
 * Stripe webhook router. Mount BEFORE `express.json()`:
 *
 *   app.use('/api/billing/webhook', createBillingWebhookRouter({ service }));
 *   app.use(express.json());
 *
 * If json parsing has already consumed the body, signature verification fails.
 */
export function createBillingWebhookRouter(opts: BillingWebhookRouterOptions): Router {
    const router = Router();
    const controller = new BillingWebhookController(opts.service);
    router.post(
        '/',
        express.raw({ type: 'application/json' }),
        controller.handleWebhook,
    );
    return router;
}
