import 'dotenv/config';
import express from 'express';
import { loadKeysFromEnv } from './config.js';
import { initUsagePublisher } from './services/usage.js';
import healthRouter from './routes/health.js';
import keysRouter from './routes/keys.js';
import completionsRouter from './routes/completions.js';
import responsesRouter from './routes/responses.js';
import embeddingsRouter from './routes/embeddings.js';
import agentConfigsRouter from './routes/agent-configs.js';
import orgKeysRouter from './routes/org-keys.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI || 'redis://localhost:6379';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Load provider keys from environment
loadKeysFromEnv();

// Initialize Redis usage publisher
initUsagePublisher(REDIS_URL);

// Routes
app.use(healthRouter);
app.use(keysRouter);
app.use(agentConfigsRouter);
app.use(orgKeysRouter);
app.use(completionsRouter);
app.use(responsesRouter);
app.use(embeddingsRouter);

app.listen(PORT, () => {
    console.log(`[LLM-PROXY] Running on port ${PORT}`);

    // Notify admin service to re-sync API keys and configs
    const adminUrl = (process.env.ADMIN_API_URL || 'http://localhost:3008').replace(/\/+$/, '');
    const serviceKey = process.env.INTERNAL_SERVICE_KEY || '';
    if (serviceKey) {
        setTimeout(() => {
            fetch(`${adminUrl}/api/internal/sync-proxy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-service-key': serviceKey,
                },
                body: '{}',
            })
                .then(res => {
                    if (res.ok) console.log('[LLM-PROXY] Admin key sync triggered successfully');
                    else console.warn(`[LLM-PROXY] Admin key sync returned ${res.status}`);
                })
                .catch(err => {
                    console.warn(`[LLM-PROXY] Could not reach admin for key sync: ${err.message}`);
                });
        }, 2000); // wait 2s for admin to be ready
    } else {
        console.warn('[LLM-PROXY] INTERNAL_SERVICE_KEY not set — skipping admin key sync notification');
    }
});
