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
        service: 'graph-db',
        port: config.port,
        timestamp: new Date().toISOString()
    });
});

// API routes
app.use('/api', apiRouter);

// Start server
app.listen(config.port, () => {
    console.log(`Graph-db service running on port ${config.port}`);
});

export default app;
