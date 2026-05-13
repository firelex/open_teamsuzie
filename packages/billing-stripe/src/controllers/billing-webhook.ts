import type { Request, Response } from 'express';
import type { BillingService } from '../services/billing.js';

/**
 * Stripe webhook handler. The router that mounts this must use
 * `express.raw({ type: 'application/json' })` so the signature check has the
 * exact bytes Stripe signed — not a JSON-parsed object.
 */
export class BillingWebhookController {

    private billingService: BillingService;

    constructor(billingService: BillingService) {
        this.billingService = billingService;
    }

    handleWebhook = async (req: Request, res: Response): Promise<void> => {
        const sig = req.headers['stripe-signature'];
        if (!sig || Array.isArray(sig)) {
            res.status(400).json({ error: 'Missing stripe-signature header' });
            return;
        }

        let event: Record<string, unknown>;
        try {
            event = this.billingService.constructWebhookEvent(
                req.body as Buffer,
                sig,
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Signature verification failed';
            console.error('[billing-stripe] Webhook signature verification failed:', message);
            res.status(400).json({ error: 'Webhook signature verification failed' });
            return;
        }

        const eventType = event.type as string;
        const data = (event.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined;
        if (!data) {
            res.status(400).json({ error: 'Webhook payload missing data.object' });
            return;
        }

        try {
            switch (eventType) {
                case 'checkout.session.completed':
                    await this.billingService.processCheckoutCompleted(data);
                    break;
                case 'payment_intent.succeeded':
                    await this.billingService.processPaymentSucceeded(data);
                    break;
                case 'payment_intent.payment_failed':
                    await this.billingService.processPaymentFailed(data);
                    break;
                default:
                    // Stripe sends many event types we don't care about.
                    // Returning 200 prevents Stripe from retrying.
                    break;
            }
            res.json({ received: true });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Webhook processing failed';
            console.error(`[billing-stripe] Webhook processing error (${eventType}):`, message);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    };
}
