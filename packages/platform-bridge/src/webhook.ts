/**
 * Platform Webhook Handler
 *
 * Express router that handles incoming webhooks from the mothership:
 * - install: mothership notifies agent that an org has installed it
 * - uninstall: org removed the agent
 * - dm: inter-agent direct message routed via mothership
 * - ping: health/connectivity check
 */

import { Router, type Request, type Response } from 'express';
import { createPlatformTokenGuard, type PlatformBridgeConfig } from './middleware.js';

export interface WebhookHandlers {
    /** Called when an org installs this agent via the marketplace. */
    onInstall?: (context: InstallContext) => Promise<void>;
    /** Called when an org uninstalls this agent. */
    onUninstall?: (context: UninstallContext) => Promise<void>;
    /** Called when another agent sends a DM via the mothership. */
    onDirectMessage?: (context: DMContext) => Promise<{ response: string }>;
}

export interface InstallContext {
    platform_api_key: string;
    platform_base_url: string;
    org_id: string;
    agent_id: string;
}

export interface UninstallContext {
    org_id: string;
    agent_id: string;
}

export interface DMContext {
    from_agent: { id: string; name: string };
    message: string;
    context?: Record<string, unknown>;
}

/**
 * Creates an Express router for the mothership webhook endpoint.
 * Mount at the path you registered (default: /api/webhook/mothership).
 */
export function createWebhookRouter(
    config: PlatformBridgeConfig,
    handlers: WebhookHandlers = {}
): Router {
    const router = Router();
    const guard = createPlatformTokenGuard(config);

    router.post('/', guard, async (req: Request, res: Response) => {
        const { type } = req.body;

        try {
            switch (type) {
                case 'install': {
                    const context = req.body.context as InstallContext;
                    if (handlers.onInstall) {
                        await handlers.onInstall(context);
                    }
                    res.json({ status: 'ok' });
                    break;
                }

                case 'uninstall': {
                    const context = req.body.context as UninstallContext;
                    if (handlers.onUninstall) {
                        await handlers.onUninstall(context);
                    }
                    res.json({ status: 'ok' });
                    break;
                }

                case 'dm': {
                    if (!handlers.onDirectMessage) {
                        res.status(501).json({ error: 'DM handler not implemented' });
                        return;
                    }
                    const result = await handlers.onDirectMessage({
                        from_agent: req.body.from_agent,
                        message: req.body.message,
                        context: req.body.context,
                    });
                    res.json(result);
                    break;
                }

                case 'dm_async': {
                    // Async DM: respond 202 immediately so the mothership can
                    // free its dispatch slot, then run the same handler in the
                    // background and POST the result to the supplied callback
                    // URL. Same handler signature as 'dm' — the choice of
                    // sync vs async is the mothership's call (based on which
                    // tool the originating agent invoked).
                    if (!handlers.onDirectMessage) {
                        res.status(501).json({ error: 'DM handler not implemented' });
                        return;
                    }
                    const jobId: string | undefined = req.body.job_id;
                    const callbackUrl: string | undefined = req.body.callback_url;
                    if (!jobId || !callbackUrl) {
                        res.status(400).json({ error: 'job_id and callback_url are required for dm_async' });
                        return;
                    }
                    // Acknowledge receipt immediately so the mothership can
                    // proceed. Anything we return after this is via callback.
                    res.status(202).json({ status: 'accepted', job_id: jobId });

                    // Spawn the handler. NEVER let an exception escape the
                    // setImmediate — Node treats uncaught async errors as
                    // process-fatal in some configs. Always end with a
                    // callback POST so the mothership doesn't sit on a
                    // pending job until the timeout sweeper fires.
                    const ctx: DMContext = {
                        from_agent: req.body.from_agent,
                        message: req.body.message,
                        context: req.body.context,
                    };
                    const platformToken = (config as PlatformBridgeConfig).platformToken ?? '';
                    setImmediate(async () => {
                        let payload: { job_id: string; response?: string; error?: string };
                        try {
                            const result = await handlers.onDirectMessage!(ctx);
                            payload = { job_id: jobId, response: result.response };
                        } catch (err: any) {
                            payload = { job_id: jobId, error: err?.message ?? String(err) };
                        }
                        await postCallback(callbackUrl, platformToken, payload);
                    });
                    break;
                }

                case 'ping':
                    res.json({ status: 'ok' });
                    break;

                default:
                    res.status(400).json({ error: `Unknown webhook type: ${type}` });
            }
        } catch (err: any) {
            console.error(`[platform-bridge] Webhook error (${type}):`, err);
            res.status(500).json({ error: err.message || 'Internal error' });
        }
    });

    return router;
}

/**
 * POST the result of an async DM job back to the mothership. Retries 3×
 * with exponential backoff on network failure or 5xx. Logs and gives up
 * after the last attempt — the mothership's timeout sweeper will eventually
 * mark the job as 'timed_out' so callers don't hang forever.
 */
async function postCallback(
    callbackUrl: string,
    platformToken: string,
    payload: { job_id: string; response?: string; error?: string },
): Promise<void> {
    const maxAttempts = 3;
    let attempt = 0;
    let delayMs = 500;
    while (attempt < maxAttempts) {
        attempt++;
        try {
            const resp = await fetch(callbackUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Platform-Token': platformToken,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15_000),
            });
            if (resp.ok) return;
            if (resp.status >= 400 && resp.status < 500) {
                // 4xx is a programming error (bad job_id, missing token, etc.)
                // — retrying won't help. Log and give up.
                const body = await resp.text().catch(() => '');
                console.error(`[platform-bridge] Callback ${resp.status} for job ${payload.job_id}: ${body.slice(0, 200)}`);
                return;
            }
            console.warn(`[platform-bridge] Callback attempt ${attempt}/${maxAttempts} for ${payload.job_id} returned ${resp.status}`);
        } catch (err: any) {
            console.warn(`[platform-bridge] Callback attempt ${attempt}/${maxAttempts} for ${payload.job_id} failed: ${err.message}`);
        }
        if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, delayMs));
            delayMs *= 2;
        }
    }
    console.error(`[platform-bridge] Gave up delivering callback for ${payload.job_id} after ${maxAttempts} attempts`);
}
