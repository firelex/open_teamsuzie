/**
 * Tiny, dependency-free YAML frontmatter parser tailored to PERSONA.md.
 * Supports the field shapes we actually emit:
 *   name: <string>
 *   description: <string>
 *   avatar: <string>
 *   model: <string>
 *   allowedTools: a, b, c          (comma-separated)
 *   allowedTools: ["a", "b", "c"]  (JSON array)
 *   blockedTools: ...
 *
 * Anything fancier (block scalars, anchors, nested objects) is out of scope —
 * if a persona file needs that, parse the body separately or upgrade later.
 */
export interface PersonaFrontmatter {
  name?: string;
  description?: string;
  avatar?: string;
  model?: string;
  allowedTools?: string[];
  blockedTools?: string[];
}

export interface ParsedPersonaFile {
  frontmatter: PersonaFrontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parsePersonaFile(content: string): ParsedPersonaFile {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content.trim() };

  const fm: PersonaFrontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const rawValue = m[2];
    switch (key) {
      case 'name':
      case 'description':
      case 'avatar':
      case 'model':
        fm[key] = stripQuotes(rawValue);
        break;
      case 'allowedTools':
      case 'blockedTools':
        fm[key] = parseStringList(rawValue);
        break;
      default:
        // Unknown keys are ignored — keeps the parser permissive.
        break;
    }
  }
  return { frontmatter: fm, body: content.slice(match[0].length).trim() };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseStringList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through to comma-split
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
