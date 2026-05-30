import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AnyToolDefinition } from '@teamsuzie/agent-loop';

interface TemplateFrontmatter {
  id: string;
  title: string;
  description: string;
  document_type: string;
  when_to_use?: string;
}

interface LoadedTemplate extends TemplateFrontmatter {
  body: string;
  filename: string;
}

export interface BuildTemplateToolsOptions {
  /** Directory of `<id>.md` files. Each file has YAML-style frontmatter
   *  (id/title/description/document_type/when_to_use) followed by the
   *  markdown body. Missing dir → no tools registered. */
  templatesDir: string;
}

/**
 * Parse a minimal subset of YAML frontmatter — enough for the fixed key set
 * we use in template files. Supports plain `key: value` lines (string values),
 * and treats values without surrounding quotes as raw strings (trimmed). No
 * arrays, nested objects, or block scalars.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: raw };

  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Record<string, string> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body };
}

async function loadTemplates(dir: string): Promise<LoadedTemplate[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }

  const out: LoadedTemplate[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith('.md')) continue;
    const filename = path.join(dir, name);
    const raw = await fs.readFile(filename, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.id || !meta.title || !meta.description || !meta.document_type) {
      console.warn(`[agent-runtime] templates: skipping ${name} — missing required frontmatter (id/title/description/document_type)`);
      continue;
    }
    out.push({
      id: meta.id,
      title: meta.title,
      description: meta.description,
      document_type: meta.document_type,
      when_to_use: meta.when_to_use,
      body,
      filename,
    });
  }
  return out;
}

/**
 * Build the document-template tools — `list_templates` and `get_template`.
 *
 * Templates are loaded once from disk at server startup. The list tool
 * returns metadata only (id/title/description/document_type/when_to_use) so
 * the model can pick the right one without reading every body. The get tool
 * returns the markdown body, which a drafting flow can pass to
 * `set_outline` / `write_section` as scaffolding.
 *
 * Templates supply the *layout* (headings, boilerplate sections); the model
 * fills in the language. Returns [] when the directory is missing or has no
 * valid `*.md` files, so the model never sees broken-looking tools.
 */
export async function buildTemplateTools(opts: BuildTemplateToolsOptions): Promise<AnyToolDefinition[]> {
  const templates = await loadTemplates(opts.templatesDir);
  if (templates.length === 0) return [];

  console.log(
    `[agent-runtime] loaded ${templates.length} template(s) from ${opts.templatesDir}: ${templates.map((t) => t.id).join(', ')}`,
  );

  const byId = new Map(templates.map((t) => [t.id, t]));
  const enumIds = templates.map((t) => t.id);

  const listTool: AnyToolDefinition = {
    name: 'list_templates',
    description:
      'List the available document templates (layouts for the kinds of documents this app drafts — e.g. memoranda, opinions, agreements, briefs, board minutes). Each entry includes an id, title, document_type, description, and a short when_to_use note. Call this when the user asks you to draft something and you want to pick the right scaffold; then call `get_template` with the chosen id.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return {
        templates: templates.map((t) => ({
          id: t.id,
          title: t.title,
          document_type: t.document_type,
          description: t.description,
          when_to_use: t.when_to_use,
        })),
      };
    },
  };

  const getTool: AnyToolDefinition = {
    name: 'get_template',
    description:
      'Fetch a document template by id and return its markdown body. Use the body as scaffolding for a drafting flow: derive `set_outline` from the template\'s top-level (##) headings only, then fill each section with `write_section`. Preamble that precedes the first ## (e.g. date, addressee block, salutation, opening paragraph) and ### sub-headings belong inside their parent section as inline markdown — not as separate outline entries. Call set_outline once; don\'t reset it mid-draft. Replace [BRACKETED PLACEHOLDERS] with real values.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Template id from `list_templates`.',
          ...(enumIds.length > 0 ? { enum: enumIds } : {}),
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async execute(args: { id: string }) {
      const tpl = byId.get(args.id);
      if (!tpl) {
        const available = enumIds.length > 0 ? enumIds.join(', ') : '(none loaded)';
        throw new Error(`get_template: unknown id "${args.id}". Available: ${available}.`);
      }
      return {
        id: tpl.id,
        title: tpl.title,
        document_type: tpl.document_type,
        description: tpl.description,
        when_to_use: tpl.when_to_use,
        markdown: tpl.body,
      };
    },
  };

  return [listTool, getTool];
}
