import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { startAgent } from '@teamsuzie/agent-runtime/server';
import type { Extension } from '@teamsuzie/agent-runtime/extensions';

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

  await startAgent({
    manifestPath,
    dbPath: process.env.DB_PATH ?? './data/agent.db',
    personasDir: './personas',
    workflowsSeedPath: './workflows.seed.json',
    devAuth: process.env.AGENT_DEV_AUTH === 'true',
    extensions,
  });
}

main().catch((err) => {
  console.error('[omnibus] failed to start:', err);
  process.exit(1);
});
