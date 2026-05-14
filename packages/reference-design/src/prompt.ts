import type { ReferenceDoc } from './types.js';

/**
 * Flatten a ReferenceDoc into a system-prompt fragment suitable for inclusion
 * in a drafting agent's prompt. Captures the structure and voice; the source
 * file (for pandoc reference-doc) is a separate concern at export time.
 */
export function useReferenceDesignInPrompt(ref: ReferenceDoc): string {
  return [
    `=== REFERENCE DESIGN (${ref.docType}) — ${ref.displayName} ===`,
    'Below is a canonical example of this document type. Match its structure,',
    'section headings, voice, and conventions when drafting new documents of',
    'the same type.',
    '',
    ref.contentMarkdown,
    '',
    '=== END REFERENCE ===',
  ].join('\n');
}
