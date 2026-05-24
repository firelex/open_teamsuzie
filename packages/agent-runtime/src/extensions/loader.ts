import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Extension } from './types.js';

const INDEX_CANDIDATES = ['index.mjs', 'index.js', 'index.ts'];

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
    const mod = await import(pathToFileURL(indexFile).href);
    const ext = (mod.default ?? mod) as Extension;
    if (!ext.name) {
      throw new Error(`[agent-runtime] extension at ${indexFile} is missing 'name'`);
    }
    out.push(ext);
  }
  return out;
}
