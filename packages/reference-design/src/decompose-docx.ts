import { convertDocxToMarkdown } from '@teamsuzie/markdown-document';
import type { ReferenceDoc, DocType } from './types.js';

export interface DecomposeDocxOptions {
  docType: DocType;
  displayName: string;
  sourceFilePath: string;
}

/**
 * Decompose a DOCX reference into a ReferenceDoc. v1 captures content as
 * markdown via mammoth+turndown. The source file is kept on disk so pandoc
 * can use it as a --reference-doc template at generation time.
 *
 * designUsable is a heuristic: true if mammoth's conversion produced no
 * "unsupported style" warnings (suggesting the source uses standard Word
 * styles, which is what pandoc --reference-doc needs to apply them).
 */
export async function decomposeDocx(
  bytes: Buffer | Uint8Array,
  options: DecomposeDocxOptions,
): Promise<ReferenceDoc> {
  const { markdown, messages } = await convertDocxToMarkdown(bytes);
  const warnings = messages.map(m => m.message);
  const hasStyleIssues = warnings.some(w => /unsupported|unknown style/i.test(w));
  return {
    id: makeId(options.displayName),
    docType: options.docType,
    displayName: options.displayName,
    sourceFilePath: options.sourceFilePath,
    sourceMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    contentMarkdown: markdown,
    designUsable: !hasStyleIssues,
    ingestedAt: new Date().toISOString(),
    warnings,
  };
}

function makeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
