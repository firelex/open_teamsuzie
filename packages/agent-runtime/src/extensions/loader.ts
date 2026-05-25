import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Extension } from './types.js';

const INDEX_CANDIDATES = ['index.mjs', 'index.js', 'index.ts'];
// README convention from docs/COMPOSITION.md: every extension carries a
// README so SuzieCode (and humans) can read what it does without parsing
// TypeScript. Soft-enforced via boot-log warning, not a hard error —
// older extensions keep loading.
const README_CANDIDATES = ['README.md', 'README.MD', 'readme.md'];

export async function loadExtensions(dir: string): Promise<Extension[]> {
  if (!existsSync(dir)) return [];
  const out: Extension[] = [];
  for (const name of readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (!statSync(sub).isDirectory()) continue;
    const indexFile = INDEX_CANDIDATES.map(c => path.join(sub, c)).find(existsSync);
    if (!indexFile) {
      console.warn(`[agent-runtime] extension ${name} has no index file; skipping`);
      continue;
    }
    const hasReadme = README_CANDIDATES.some((c) => existsSync(path.join(sub, c)));
    if (!hasReadme) {
      console.warn(
        `[agent-runtime] extension '${name}' has no README.md — `
        + `convention is one README per extension so SuzieCode + humans can `
        + `read it without parsing source. See docs/COMPOSITION.md.`,
      );
    }
    const mod = await import(pathToFileURL(indexFile).href);
    const ext = (mod.default ?? mod) as Extension;
    if (!ext.name) {
      throw new Error(`[agent-runtime] extension at ${indexFile} is missing 'name'`);
    }
    out.push(ext);
  }
  return out;
}
