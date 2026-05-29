/**
 * Port suzielaw personas + workflows into open_teamsuzie/presets/counsel/.
 *
 * Idempotent — re-running overwrites the outputs. Suitable for re-porting
 * if suzielaw content evolves.
 *
 * Usage:
 *
 *   cd /Users/mattsinalco/mathias/apps/suzielaw
 *   node --experimental-strip-types \
 *     /Users/mattsinalco/mathias/apps/open_teamsuzie/scripts/port-from-suzielaw/index.ts
 *
 * Why the `cd` + node flag: the workflow porter dynamically imports suzielaw
 * source TS files that themselves import @teamsuzie/* packages. Running from
 * inside the suzielaw workspace lets Node resolve those deps via suzielaw's
 * node_modules. The --experimental-strip-types flag lets Node 24 import TS
 * files directly (tsx cannot handle cross-workspace dynamic .ts imports here).
 *
 * After running, hand-pick 3 starter prompt ids from the new
 * presets/counsel/workflows.seed.json and update presets/counsel/agent.json
 * home.starterPrompts (Task 6 of the plan).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { portPersonas } from './personas.js';
import { portWorkflows } from './workflows.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<number> {
  const openTeamsuzieRoot = path.resolve(__dirname, '..', '..');
  const suzielawRoot = path.resolve(openTeamsuzieRoot, '..', 'suzielaw');
  const counselPresetDir = path.join(openTeamsuzieRoot, 'presets', 'counsel');

  if (!existsSync(suzielawRoot) || !statSync(suzielawRoot).isDirectory()) {
    console.error(`[port] suzielaw repo not found at ${suzielawRoot}`);
    console.error('[port] Expected suzielaw to be a sibling of open_teamsuzie.');
    return 1;
  }

  console.log(`[port] suzielaw: ${suzielawRoot}`);
  console.log(`[port] counsel preset: ${counselPresetDir}`);

  console.log('\n[port] === Personas ===');
  const personaResult = portPersonas({ suzielawRoot, counselPresetDir });
  console.log(`[port] wrote ${personaResult.written.length} personas`);
  for (const w of personaResult.written) {
    if (w.droppedTools.length > 0) {
      console.log(`[port]   ${w.id}: dropped ${w.droppedTools.length} tool(s) — ${w.droppedTools.join(', ')}`);
    }
  }
  if (personaResult.skipped.length > 0) {
    console.log('[port] skipped:');
    for (const s of personaResult.skipped) {
      console.log(`[port]   ${s.id}: ${s.reason}`);
    }
  }

  console.log('\n[port] === Workflows ===');
  const workflowResult = await portWorkflows({ suzielawRoot, counselPresetDir });
  console.log(`[port] wrote ${workflowResult.written} workflows`);
  console.log(`[port]   inline_chat: ${workflowResult.bySource.inline_chat}`);
  console.log(`[port]   generate_docx: ${workflowResult.bySource.generate_docx}`);
  console.log(`[port]   review: ${workflowResult.bySource.review}`);
  if (workflowResult.renamed.length > 0) {
    console.log('[port] renamed (id collisions):');
    for (const r of workflowResult.renamed) {
      console.log(`[port]   ${r.originalId} → ${r.newId} (${r.reason})`);
    }
  }

  console.log('\n[port] === Reminder ===');
  console.log('[port] Pick 3 starter prompt ids from workflows.seed.json and update');
  console.log('[port] presets/counsel/agent.json home.starterPrompts. Suggested:');
  console.log('[port]   one summarize-style, one draft-style, one compare-style.');

  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[port] FATAL', err);
  process.exit(1);
});
