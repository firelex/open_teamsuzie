import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { runAgentLoop } from './agent/loop.js';
import { initDocs } from './services/docs.js';
import { resetState } from './services/presentation.js';
import { fireCompletionWebhook, getAgentApiKey } from './services/webhook.js';

const app = express();
app.use(express.json());

interface Job {
    id: string;
    status: 'processing' | 'completed' | 'failed';
    filePath?: string;
    slideCount?: number;
    error?: string;
    createdAt: Date;
    agentApiKey: string | null;
}

const jobs = new Map<string, Job>();

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'pptx-agent' });
});

app.post('/api/presentations/generate', (req, res) => {
    const { instructions, model: requestedModel } = req.body as {
        instructions?: string;
        model?: string;
    };

    // Optional per-request model override. The proxy routes the named
    // model to the appropriate provider; pptx-agent never sees keys.
    // Falls back to env-resolved config.model in runAgentLoop when
    // undefined.
    const model = typeof requestedModel === 'string' && requestedModel.trim()
        ? requestedModel.trim()
        : undefined;

    if (!instructions) {
        res.status(400).json({ error: 'Missing required field: instructions' });
        return;
    }

    const agentApiKey = getAgentApiKey(req.headers as Record<string, string | undefined>);
    const jobId = crypto.randomUUID();

    const job: Job = {
        id: jobId,
        status: 'processing',
        createdAt: new Date(),
        agentApiKey,
    };
    jobs.set(jobId, job);

    // Process in background
    (async () => {
        try {
            resetState();
            const result = await runAgentLoop(instructions, model, (msg) => {
                console.log(`[JOB ${jobId.slice(0, 8)}] ${msg}`);
            });

            job.status = 'completed';
            job.filePath = result.filePath;
            job.slideCount = result.slideCount;

            // Fire webhook if agent API key was provided
            if (agentApiKey) {
                const downloadUrl = `${config.publicBaseUrl}/api/presentations/${jobId}/download`;
                const filename = path.basename(result.filePath);
                try {
                    await fireCompletionWebhook(jobId, filename, downloadUrl, agentApiKey);
                } catch (e) {
                    console.error(`[JOB ${jobId.slice(0, 8)}] Webhook failed: ${(e as Error).message}`);
                }
            }
        } catch (e) {
            job.status = 'failed';
            job.error = (e as Error).message;
            console.error(`[JOB ${jobId.slice(0, 8)}] Failed: ${job.error}`);
        }
    })();

    res.status(202).json({
        job_id: jobId,
        status: 'processing',
        message: 'Presentation generation started. You will be notified via webhook when ready.',
    });
});

app.get('/api/presentations/:id/status', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }

    const response: Record<string, unknown> = {
        job_id: job.id,
        status: job.status,
        created_at: job.createdAt,
    };

    if (job.status === 'completed' && job.filePath) {
        response.download_url = `${config.publicBaseUrl}/api/presentations/${job.id}/download`;
        response.slide_count = job.slideCount;
        response.filename = path.basename(job.filePath);
    }

    if (job.status === 'failed') {
        response.error = job.error;
    }

    res.json(response);
});

app.get('/api/presentations/:id/download', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }
    if (job.status !== 'completed' || !job.filePath) {
        res.status(404).json({ error: 'File not ready' });
        return;
    }

    const filename = path.basename(job.filePath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const buffer = await fs.readFile(job.filePath);
    res.send(buffer);
});

initDocs();

app.listen(config.port, () => {
    console.log(`PPTX Agent listening on port ${config.port}`);
});
