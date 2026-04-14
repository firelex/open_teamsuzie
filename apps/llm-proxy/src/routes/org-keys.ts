import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import { setAgentOrgMapping, setOrgProviderKeys } from '../config.js';

const router: IRouter = Router();

/**
 * POST /admin/sync-org-keys
 * Body: { agent_org_mapping: { [keyHash]: orgId }, org_keys: { [orgId]: { [provider]: apiKey } } }
 *
 * Called by the admin service to push org-level provider key overrides to the proxy.
 */
router.post('/admin/sync-org-keys', (req: Request, res: Response) => {
    const { agent_org_mapping, org_keys } = req.body;

    if (!agent_org_mapping || typeof agent_org_mapping !== 'object') {
        res.status(400).json({ error: 'Missing or invalid "agent_org_mapping" field' });
        return;
    }
    if (!org_keys || typeof org_keys !== 'object') {
        res.status(400).json({ error: 'Missing or invalid "org_keys" field' });
        return;
    }

    setAgentOrgMapping(agent_org_mapping);
    setOrgProviderKeys(org_keys);

    const agentCount = Object.keys(agent_org_mapping).length;
    const orgCount = Object.keys(org_keys).length;
    console.log(`[LLM-PROXY] Synced org keys: ${agentCount} agent mappings, ${orgCount} orgs with keys`);
    res.json({ status: 'ok', agents: agentCount, orgs: orgCount });
});

export default router;
