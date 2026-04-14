import { Router, type IRouter } from 'express';
import crypto from 'crypto';
import { setProviderKeys } from '../config.js';

const router: IRouter = Router();

function keyFingerprint(value: string): string {
    return `${value.length}:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

/**
 * POST /admin/reload-keys
 * Hot-reload provider API keys without restarting the proxy.
 * Called by admin service when config values change.
 *
 * Body: { keys: { OPENAI_API_KEY: "sk-...", DASHSCOPE_API_KEY: "sk-...", ... } }
 */
router.post('/admin/reload-keys', (req, res) => {
    const { keys } = req.body;

    if (!keys || typeof keys !== 'object') {
        res.status(400).json({ error: 'Missing or invalid "keys" object in body' });
        return;
    }

    setProviderKeys(keys);
    const count = Object.keys(keys).filter(k => keys[k]).length;
    const fpPreview = Object.entries(keys)
        .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
        .map(([k, v]) => `${k}=${keyFingerprint(String(v).trim())}`)
        .join(', ');
    console.log(`[LLM-PROXY] Reloaded ${count} provider keys`);
    console.log(`[LLM-PROXY] Provider key fingerprints: ${fpPreview || 'none'}`);

    res.json({ status: 'ok', keys_loaded: count });
});

export default router;
