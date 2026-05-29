import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

interface SourceEntry {
  id: string;
  name?: string;
  title?: string; // prompts.ts uses `title` instead of `name`
  description?: string;
  prompt: string;
  practiceAreas?: string[];
  outputMode?: string;
  columnConfig?: unknown[];
  [key: string]: unknown;
}

interface NormalizedEntry {
  id: string;
  name: string;
  description: string;
  prompt: string;
  practiceAreas: string[];
  outputMode: 'inline_chat' | 'generate_docx' | 'review';
  columnConfig?: unknown[];
}

export interface PortWorkflowsOptions {
  suzielawRoot: string;
  counselPresetDir: string;
}

export interface PortWorkflowsResult {
  written: number;
  bySource: Record<'inline_chat' | 'generate_docx' | 'review', number>;
  renamed: Array<{ originalId: string; newId: string; reason: string }>;
}

function normalize(raw: SourceEntry, defaultMode: NormalizedEntry['outputMode']): NormalizedEntry {
  // prompts.ts uses `title` as the display name; other files use `name`
  const name = (raw.name ?? raw.title ?? '').trim();
  const out: NormalizedEntry = {
    id: raw.id,
    name,
    description: raw.description ?? '',
    prompt: raw.prompt,
    practiceAreas: raw.practiceAreas ?? [],
    outputMode: (raw.outputMode as NormalizedEntry['outputMode']) ?? defaultMode,
  };
  if (Array.isArray(raw.columnConfig) && raw.columnConfig.length > 0) {
    out.columnConfig = raw.columnConfig;
  }
  return out;
}

export async function portWorkflows(opts: PortWorkflowsOptions): Promise<PortWorkflowsResult> {
  const dataDir = path.join(opts.suzielawRoot, 'apps', 'suzielaw', 'src', 'data');

  const promptsModule = await import(path.join(dataDir, 'prompts.ts'));
  const docxModule = await import(path.join(dataDir, 'docx-workflows.ts'));
  const reviewsModule = await import(path.join(dataDir, 'review-templates.ts'));

  // prompts.ts → PROMPTS; docx-workflows.ts → DOCX_WORKFLOWS; review-templates.ts → REVIEW_TEMPLATES
  const promptsRaw = (promptsModule.PROMPTS ?? promptsModule.default) as SourceEntry[];
  const docxRaw = (docxModule.DOCX_WORKFLOWS ?? docxModule.default) as SourceEntry[];
  const reviewsRaw = (reviewsModule.REVIEW_TEMPLATES ?? reviewsModule.default) as SourceEntry[];

  if (!Array.isArray(promptsRaw)) throw new Error('expected an array export from prompts.ts');
  if (!Array.isArray(docxRaw)) throw new Error('expected an array export from docx-workflows.ts');
  if (!Array.isArray(reviewsRaw)) throw new Error('expected an array export from review-templates.ts');

  const out: NormalizedEntry[] = [];
  const seenIds = new Map<string, 'inline_chat' | 'generate_docx' | 'review'>();
  const renamed: PortWorkflowsResult['renamed'] = [];

  function add(entry: SourceEntry, defaultMode: NormalizedEntry['outputMode']): void {
    let normalized = normalize(entry, defaultMode);
    if (seenIds.has(normalized.id)) {
      const newId = `${normalized.outputMode}:${normalized.id}`;
      renamed.push({
        originalId: normalized.id,
        newId,
        reason: `collision with ${seenIds.get(normalized.id)} entry`,
      });
      normalized = { ...normalized, id: newId };
    }
    seenIds.set(normalized.id, normalized.outputMode);
    out.push(normalized);
  }

  for (const e of promptsRaw) add(e, 'inline_chat');
  for (const e of docxRaw) add(e, 'generate_docx');
  for (const e of reviewsRaw) add(e, 'review');

  out.sort((a, b) => a.id.localeCompare(b.id));

  mkdirSync(opts.counselPresetDir, { recursive: true });
  writeFileSync(
    path.join(opts.counselPresetDir, 'workflows.seed.json'),
    JSON.stringify(out, null, 2) + '\n',
  );

  return {
    written: out.length,
    bySource: {
      inline_chat: out.filter((w) => w.outputMode === 'inline_chat').length,
      generate_docx: out.filter((w) => w.outputMode === 'generate_docx').length,
      review: out.filter((w) => w.outputMode === 'review').length,
    },
    renamed,
  };
}
