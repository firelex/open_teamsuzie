import { ApprovalQueueError, type ApprovalQueue } from '@teamsuzie/approvals';
import { OPERATION_NAMES, type OperationName } from '@teamsuzie/webmail-routes';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AlertStore } from './alerts.js';
import { bearerToken, sameToken } from './auth.js';
import type { AccountHandler } from './handler.js';
import { SEND_APPROVAL_ACTION } from './jobs.js';

export interface AdminDeps {
    adminToken: string;
    handlers: Map<string, Pick<AccountHandler, 'state' | 'requestLogin' | 'requestRelearn' | 'requestCanary' | 'requestCapture'>>;
    approvals: ApprovalQueue;
    /** Replace a provider's route with its starting route and mark its actions healthy; returns the new version. */
    resetRoute: (provider: string) => string;
    alerts: AlertStore;
    log: (message: string) => void;
}

type Handler = (req: Request, res: Response) => Promise<void>;

/** Endpoints for the user's CLI. Every request needs the admin token. */
export function adminRouter(deps: AdminDeps): Router {
    const router = Router();

    router.use((req: Request, res: Response, next: NextFunction) => {
        const token = bearerToken(req.headers.authorization);
        if (token === null || !sameToken(token, deps.adminToken)) {
            res.status(401).json({ error: 'The admin token is missing or wrong' });
            return;
        }
        next();
    });

    const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
        fn(req, res).catch(next);
    };

    const handlerFor = (req: Request, res: Response) => {
        const handler = deps.handlers.get(String(req.params.account).toLowerCase());
        if (!handler) res.status(404).json({ error: `Unknown account ${req.params.account}` });
        return handler;
    };

    router.get('/status', route(async (_req, res) => {
        res.json([...deps.handlers.values()].map((h) => h.state()));
    }));

    router.post('/login/:account', route(async (req, res) => {
        const handler = handlerFor(req, res);
        if (!handler) return;
        // Sign-in waits for the user for minutes; answer now and let them watch status.
        handler.requestLogin().then(
            (outcome) => deps.log(`[${req.params.account}] sign-in requested from the CLI: ${outcome}`),
            (error: unknown) => deps.log(`[${req.params.account}] sign-in requested from the CLI failed: ${(error as Error).stack ?? String(error)}`),
        );
        res.status(202).json({ started: true, message: 'A Chrome window will open for you to sign in. Check `email-agent status` afterwards.' });
    }));

    router.post('/relearn/:account/:operation', route(async (req, res) => {
        const handler = handlerFor(req, res);
        if (!handler) return;
        const operation = String(req.params.operation);
        if (!(OPERATION_NAMES as readonly string[]).includes(operation)) {
            res.status(400).json({ error: `Unknown operation ${operation}. Operations: ${OPERATION_NAMES.join(', ')}` });
            return;
        }
        // Relearning drives the browser for minutes; answer now and let the user watch status.
        handler.requestRelearn(operation as OperationName).then(
            (outcome) => deps.log(`[${req.params.account}] relearn of ${operation} requested from the CLI: ${outcome}`),
            (error: unknown) => deps.log(`[${req.params.account}] relearn of ${operation} requested from the CLI failed: ${(error as Error).stack ?? String(error)}`),
        );
        res.status(202).json({ started: true, operation, message: `Relearning ${operation} has started. Run \`email-agent status\` to follow it.` });
    }));

    router.post('/canary/:account', route(async (req, res) => {
        const handler = handlerFor(req, res);
        if (!handler) return;
        res.json(await handler.requestCanary(req.query.check_only !== 'true'));
    }));

    router.post('/capture/:account', route(async (req, res) => {
        const handler = handlerFor(req, res);
        if (!handler) return;
        res.json({ files: await handler.requestCapture() });
    }));

    router.post('/routes/:provider/reset', route(async (req, res) => {
        const provider = String(req.params.provider);
        if (provider !== 'gmail' && provider !== 'outlook') {
            res.status(400).json({ error: `Unknown provider ${provider}. Providers: gmail, outlook` });
            return;
        }
        res.json({ provider, route_version: deps.resetRoute(provider) });
    }));

    router.get('/approvals', route(async (_req, res) => {
        res.json(await deps.approvals.list({ status: 'pending', action_type: SEND_APPROVAL_ACTION }));
    }));

    router.post('/approvals/:id/approve', route(async (req, res) => {
        const id = String(req.params.id);
        await deps.approvals.review(id, { reviewer_id: 'admin', verdict: 'approve' });
        const item = await deps.approvals.dispatch(id);
        if (item.status !== 'dispatched') {
            res.status(500).json({ error: `Approved, but queuing the send failed: ${item.dispatch?.error}`, item });
            return;
        }
        res.json(item);
    }));

    router.post('/approvals/:id/reject', route(async (req, res) => {
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() !== '' ? req.body.reason.trim() : 'Rejected by the user';
        res.json(await deps.approvals.review(String(req.params.id), { reviewer_id: 'admin', verdict: 'reject', reason }));
    }));

    router.get('/alerts', route(async (req, res) => {
        const after = Number(req.query.after ?? 0);
        res.json(deps.alerts.list({ after: Number.isFinite(after) ? after : 0, limit: 200 }));
    }));

    router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (error instanceof ApprovalQueueError) {
            res.status(error.code === 'NOT_FOUND' ? 404 : 409).json({ error: error.message });
            return;
        }
        deps.log(`admin request failed: ${(error as Error).stack ?? String(error)}`);
        res.status(500).json({ error: (error as Error).message });
    });

    return router;
}
