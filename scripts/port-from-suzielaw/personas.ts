import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { RUNTIME_SUPPORTED_TOOLS } from './runtime-supported-tools.js';

export interface PortPersonasOptions {
  suzielawRoot: string;
  counselPresetDir: string;
}

export interface PortPersonasResult {
  written: Array<{ id: string; droppedTools: string[]; keptTools: string[] }>;
  skipped: Array<{ id: string; reason: string }>;
}

function parseAllowedTools(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function serializeAllowedTools(tools: string[]): string {
  return tools.join(', ');
}

function filterTools(declared: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const t of declared) {
    if (RUNTIME_SUPPORTED_TOOLS.has(t)) kept.push(t);
    else dropped.push(t);
  }
  return { kept, dropped };
}

export function portPersonas(opts: PortPersonasOptions): PortPersonasResult {
  const sourceDir = path.join(opts.suzielawRoot, 'apps', 'suzielaw', 'personas');
  const destDir = path.join(opts.counselPresetDir, 'personas');

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`suzielaw personas dir not found: ${sourceDir}`);
  }
  mkdirSync(destDir, { recursive: true });

  const written: PortPersonasResult['written'] = [];
  const skipped: PortPersonasResult['skipped'] = [];

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const sourceFile = path.join(sourceDir, id, 'PERSONA.md');
    if (!existsSync(sourceFile)) {
      skipped.push({ id, reason: 'no PERSONA.md in source dir' });
      continue;
    }

    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(readFileSync(sourceFile, 'utf8'));
    } catch (err) {
      skipped.push({ id, reason: `frontmatter parse failed: ${err instanceof Error ? err.message : err}` });
      continue;
    }

    const declared = parseAllowedTools(parsed.data.allowedTools);
    const { kept, dropped } = filterTools(declared);

    const newFrontmatter: Record<string, unknown> = {};
    if (typeof parsed.data.name === 'string') newFrontmatter.name = parsed.data.name;
    if (typeof parsed.data.description === 'string') newFrontmatter.description = parsed.data.description;
    if (typeof parsed.data.avatar === 'string') newFrontmatter.avatar = parsed.data.avatar;
    if (kept.length > 0) newFrontmatter.allowedTools = serializeAllowedTools(kept);

    const newContent = matter.stringify(parsed.content, newFrontmatter);

    const destPersonaDir = path.join(destDir, id);
    mkdirSync(destPersonaDir, { recursive: true });
    writeFileSync(path.join(destPersonaDir, 'PERSONA.md'), newContent);

    written.push({ id, droppedTools: dropped, keptTools: kept });
  }

  return { written, skipped };
}
