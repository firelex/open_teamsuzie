import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { bearerToken, sameToken } from './auth.js';
import type { AgentConfig } from './config.js';
import { CONSOLE_HTML } from './console-page.js';
import { createMcpServer, type McpDeps } from './mcp.js';

/** The agent id the console acts as. No send rule names it, so every send it makes waits for approval. */
export const CONSOLE_AGENT_ID = 'console';

export interface ConsoleDeps {
    config: AgentConfig;
    mcpDeps: McpDeps;
}

/**
 * A test page for trying the service by hand. Its mail actions go through the same MCP tools agents use (over an
 * in-memory MCP connection, as the `console` agent); account actions use the admin API. Both need the admin token.
 */
export function consoleRouter(deps: ConsoleDeps): Router {
    const router = Router();

    router.get('/', (_req: Request, res: Response) => {
        res.type('html').send(CONSOLE_HTML);
    });

    router.post('/api/tool', async (req: Request, res: Response, next: NextFunction) => {
        const token = bearerToken(req.headers.authorization);
        if (token === null || !sameToken(token, deps.config.admin_token)) {
            res.status(401).json({ error: 'The admin token is missing or wrong' });
            return;
        }
        const { tool, args } = req.body as { tool?: unknown; args?: unknown };
        if (typeof tool !== 'string' || typeof args !== 'object' || args === null) {
            res.status(400).json({ error: 'Send {"tool": "<name>", "args": {...}}' });
            return;
        }
        const server = createMcpServer(deps.mcpDeps, CONSOLE_AGENT_ID);
        const client = new Client({ name: 'email-agent-console', version: '0.1.0' });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        try {
            await server.connect(serverSide);
            await client.connect(clientSide);
            const result = await client.callTool({ name: tool, arguments: args as Record<string, unknown> });
            const content = result.content as Array<{ type: string; text?: string }>;
            const text = content.map((c) => c.text ?? '').join('');
            res.status(result.isError ? 422 : 200).type('json').send(text);
        } catch (error) {
            next(error);
        } finally {
            await client.close();
            await server.close();
        }
    });

    return router;
}
