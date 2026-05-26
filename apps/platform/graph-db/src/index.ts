import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServiceAuth } from '@teamsuzie/shared-auth';
import config from './config/index.js';
import apiRouter from './routes/api.js';

const app: express.Express = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: config.cors_origins,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Health check (must be defined before service-auth so liveness probes work
// without holding the shared INTERNAL_SERVICE_KEY)
app.get('/api/health', async (_req, res) => {
    res.json({
        status: 'ok',
        service: 'graph-db',
        port: config.port,
        timestamp: new Date().toISOString()
    });
});

// Service-to-service auth: every /api/* call must carry INTERNAL_SERVICE_KEY.
// The graph store is a backend service for the agent runtime + admin — it is
// never called from a browser, and request bodies choose the scope (global /
// org / agent), so an unauthenticated route would let any reachable caller
// read or wipe arbitrary tenants' data.
app.use('/api', createServiceAuth({ serviceKey: process.env.INTERNAL_SERVICE_KEY }));

// API routes
app.use('/api', apiRouter);

// Start server
app.listen(config.port, () => {
    console.log(`Graph-db service running on port ${config.port}`);
});

export default app;
