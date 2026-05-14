import { convertToMarkdown } from '@teamsuzie/document-conversion';
import type { Playbook, PlaybookSource } from './types.js';

interface LoadOptions {
  filename: string;
  originalMime: string;
}

export function loadPlaybookFromMarkdown(
  markdown: string,
  options: LoadOptions,
): Playbook {
  const title = extractTitle(markdown) ?? options.filename;
  return {
    id: slugify(title),
    title,
    body: markdown.trim(),
    source: {
      filename: options.filename,
      originalMime: options.originalMime,
      ingestedAt: new Date().toISOString(),
    },
  };
}

export async function loadPlaybookFromBinary(
  bytes: Buffer | Uint8Array,
  options: LoadOptions & { markitdownAgentBaseUrl: string },
): Promise<Playbook> {
  const { markdown } = await convertToMarkdown(bytes, {
    mime: options.originalMime,
    filename: options.filename,
    markitdownAgentBaseUrl: options.markitdownAgentBaseUrl,
  });
  return loadPlaybookFromMarkdown(markdown, {
    filename: options.filename,
    originalMime: options.originalMime,
  });
}

function extractTitle(md: string): string | undefined {
  const match = md.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
