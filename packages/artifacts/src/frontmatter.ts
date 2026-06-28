export type FrontmatterScalar = string | number | boolean | string[];
export type FrontmatterData = Record<string, FrontmatterScalar>;

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(src: string): { data: FrontmatterData; body: string } {
  const m = FM_RE.exec(src);
  if (!m) return { data: {}, body: src };
  const data: FrontmatterData = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    data[key] = parseValue(val);
  }
  return { data, body: src.slice(m[0].length) };
}

function parseValue(v: string): FrontmatterScalar {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return v.replace(/^['"]|['"]$/g, '');
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${formatValue(v)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function formatValue(v: FrontmatterScalar): string {
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  return String(v);
}
