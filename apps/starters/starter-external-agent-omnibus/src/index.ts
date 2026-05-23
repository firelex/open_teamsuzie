import 'dotenv/config';
import { startAgent } from '@teamsuzie/agent-runtime/server';

startAgent({
  manifestPath: './agent.json',
  dbPath: process.env.DB_PATH ?? './data/agent.db',
  personasDir: './personas',
  workflowsSeedPath: './workflows.seed.json',
  devAuth: process.env.AGENT_DEV_AUTH === 'true',
}).catch((err) => {
  console.error('[omnibus] failed to start:', err);
  process.exit(1);
});
