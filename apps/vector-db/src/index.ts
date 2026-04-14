import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
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

// Health check
app.get('/api/health', async (_req, res) => {
    res.json({
        status: 'ok',
        service: 'vector-db',
        port: config.port,
        milvus_enabled: config.milvus.enabled,
        timestamp: new Date().toISOString()
    });
});

// API routes
app.use('/api', apiRouter);

// Start server
app.listen(config.port, () => {
    console.log(`Vector-db service running on port ${config.port}`);
});

export default app;
