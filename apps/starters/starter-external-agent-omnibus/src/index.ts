import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { startAgent } from '@teamsuzie/agent-runtime/server';
import type { Extension } from '@teamsuzie/agent-runtime/extensions';

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn('[omnibus] AGENT_EXTRA_BODY must be a JSON object; ignoring');
    return undefined;
  } catch {
    console.warn('[omnibus] AGENT_EXTRA_BODY is not valid JSON; ignoring');
    return undefined;
  }
}

function resolveAgentFromEnv(): { baseUrl: string; model: string; apiKey?: string; extraBody?: Record<string, unknown> } | undefined {
  const baseUrl = process.env.AGENT_BASE_URL;
  const model = process.env.AGENT_MODEL;
  if (!baseUrl || !model) return undefined;
  return {
    baseUrl,
    model,
    apiKey: process.env.AGENT_API_KEY,
    extraBody: parseJsonObject(process.env.AGENT_EXTRA_BODY),
  };
}

async function main(): Promise<void> {
  const manifestPath = './agent.json';
  const extensions: Extension[] = [];

  // Conditionally register legal-research when the manifest opts in.
  // Dynamic import keeps the package out of the bundle when unused.
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        capabilities?: { legalResearch?: boolean };
      };
      if (manifest.capabilities?.legalResearch) {
        const { legalResearchExtension } = await import('@teamsuzie/legal-research');
        extensions.push(legalResearchExtension({
          courtListenerToken: process.env.COURTLISTENER_TOKEN,
          legifranceClientId: process.env.LEGIFRANCE_CLIENT_ID,
          legifranceClientSecret: process.env.LEGIFRANCE_CLIENT_SECRET,
          judilibreApiKey: process.env.JUDILIBRE_API_KEY,
          indianKanoonApiKey: process.env.INDIAN_KANOON_API_KEY,
        }));
        console.log('[omnibus] legal-research extension wired (capabilities.legalResearch=true)');
      }
    } catch (err) {
      console.warn('[omnibus] failed to pre-read manifest for extension wiring:', err);
    }
  }

  const agent = resolveAgentFromEnv();
  if (!agent) {
    console.warn('[omnibus] AGENT_BASE_URL / AGENT_MODEL not set — /api/chat will return 503.');
  }

  await startAgent({
    manifestPath,
    dbPath: process.env.DB_PATH ?? './data/agent.db',
    personasDir: './personas',
    workflowsSeedPath: './workflows.seed.json',
    devAuth: process.env.AGENT_DEV_AUTH === 'true',
    extensions,
    agent,
  });
}

main().catch((err) => {
  console.error('[omnibus] failed to start:', err);
  process.exit(1);
});
