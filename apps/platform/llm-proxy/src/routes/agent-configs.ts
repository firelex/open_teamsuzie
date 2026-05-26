import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import { setAgentConfigs } from '../config.js';
import { serviceAuthMiddleware } from '../middleware/service-auth.js';

const router: IRouter = Router();

router.use('/admin', serviceAuthMiddleware);

/**
 * POST /admin/sync-agent-configs
 * Body: { agents: { [keyHash]: { condensation_model: "dashscope/qwen-turbo" } } }
 *
 * Called by the admin service to push agent condensation configs to the proxy.
 */
router.post('/admin/sync-agent-configs', (req: Request, res: Response) => {
    const { agents } = req.body;

    if (!agents || typeof agents !== 'object') {
        res.status(400).json({ error: 'Missing or invalid "agents" field' });
        return;
    }

    setAgentConfigs(agents);

    const count = Object.keys(agents).length;
    console.log(`[LLM-PROXY] Synced ${count} agent condensation config(s)`);
    res.json({ status: 'ok', count });
});

export default router;
