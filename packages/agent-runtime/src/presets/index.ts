import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { AgentManifest } from '../manifest/schema.js';

/** Deep-merge JSON objects. Arrays are replaced, not concatenated. */
function deepMerge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (
      prev && typeof prev === 'object' && !Array.isArray(prev) &&
      v && typeof v === 'object' && !Array.isArray(v)
    ) {
      out[k] = deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function copyTreeIfMissing(srcDir: string, dstDir: string): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyTreeIfMissing(s, d);
    else if (!existsSync(d)) copyFileSync(s, d);
  }
}

export interface ApplyPresetResult {
  manifestPath: string;
  copiedSiblings: string[];
}

/**
 * Materialize a preset onto a build dir.
 *
 * Merge order for agent.json: preset ← overrides ← existing build agent.json.
 * Existing build fields always win, so re-running is idempotent.
 *
 * Sibling files (personas/, workflows.seed.json) are copied only when the
 * destination does not already exist.
 */
export function applyPreset(
  buildDir: string,
  presetDir: string,
  overrides: Partial<AgentManifest> = {},
): ApplyPresetResult {
  const presetManifestPath = path.join(presetDir, 'agent.json');
  const buildManifestPath = path.join(buildDir, 'agent.json');

  const presetManifest = existsSync(presetManifestPath)
    ? (JSON.parse(readFileSync(presetManifestPath, 'utf8')) as Partial<AgentManifest>)
    : {};
  const existingBuild = existsSync(buildManifestPath)
    ? (JSON.parse(readFileSync(buildManifestPath, 'utf8')) as Partial<AgentManifest>)
    : {};

  // preset ← overrides ← existing
  const merged = deepMerge(
    deepMerge(presetManifest as Record<string, unknown>, overrides as Record<string, unknown>),
    existingBuild as Record<string, unknown>,
  ) as unknown as AgentManifest;

  mkdirSync(buildDir, { recursive: true });
  writeFileSync(buildManifestPath, JSON.stringify(merged, null, 2) + '\n');

  // Sibling files
  const copiedSiblings: string[] = [];
  const personasSrc = path.join(presetDir, 'personas');
  const personasDst = path.join(buildDir, 'personas');
  if (existsSync(personasSrc)) {
    copyTreeIfMissing(personasSrc, personasDst);
    copiedSiblings.push('personas/');
  }
  const seedSrc = path.join(presetDir, 'workflows.seed.json');
  const seedDst = path.join(buildDir, 'workflows.seed.json');
  if (existsSync(seedSrc) && !existsSync(seedDst)) {
    copyFileSync(seedSrc, seedDst);
    copiedSiblings.push('workflows.seed.json');
  }

  return { manifestPath: buildManifestPath, copiedSiblings };
}

export function listBuiltinPresets(presetsRoot: string): string[] {
  if (!existsSync(presetsRoot)) return [];
  return readdirSync(presetsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(presetsRoot, d.name, 'agent.json')))
    .map((d) => d.name)
    .sort();
}

export function resolvePresetDir(presetsRoot: string, name: string): string {
  const dir = path.join(presetsRoot, name);
  if (!existsSync(path.join(dir, 'agent.json'))) {
    throw new Error(`Preset "${name}" not found at ${dir}/agent.json`);
  }
  return dir;
}
