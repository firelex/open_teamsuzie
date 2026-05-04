import fs from 'node:fs';
import path from 'node:path';
import { parsePersonaFile } from './frontmatter.js';
import type { Persona } from './types.js';

/**
 * Read all `<dir>/<id>/PERSONA.md` files and return them as builtin personas.
 * Missing dir → empty array (caller decides whether that's an error).
 */
export function loadPersonasFromDir(dir: string): Persona[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const personas: Persona[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isSafeId(entry.name)) continue;

    const filePath = path.join(dir, entry.name, 'PERSONA.md');
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parsePersonaFile(raw);
    if (!body) continue; // a PERSONA.md with no system prompt is meaningless

    personas.push({
      id: entry.name,
      source: 'builtin',
      name: frontmatter.name || entry.name,
      description: frontmatter.description ?? '',
      avatar: frontmatter.avatar,
      model: frontmatter.model,
      allowedTools: frontmatter.allowedTools,
      blockedTools: frontmatter.blockedTools,
      systemPrompt: body,
    });
  }
  return personas;
}

function isSafeId(id: string): boolean {
  if (!id || id.length > 100) return false;
  if (id.startsWith('.') || id.includes('/') || id.includes('\\')) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}
