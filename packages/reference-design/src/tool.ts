import type { AnyToolDefinition } from '@teamsuzie/agent-loop';
import { useReferenceDesignInPrompt } from './prompt.js';
import type { ReferenceDoc } from './types.js';

/**
 * Subset of the store API the tool needs — sync `get` returning a doc or null.
 * `ReferenceStore` satisfies this interface structurally.
 */
export interface DecomposeReferenceStoreLike {
  get(id: string): ReferenceDoc | null;
}

export function buildDecomposeReferenceTool(store: DecomposeReferenceStoreLike): AnyToolDefinition {
  return {
    name: 'decompose_reference',
    description:
      'Fetch a reference design (uploaded canonical example) and return a prompt-ready fragment describing its structure and voice. Optionally returns the source file path so generate_docx can use it as a pandoc reference-doc.',
    parameters: {
      type: 'object',
      properties: {
        reference_doc_id: { type: 'string', description: 'ID of a reference doc from /api/references' },
      },
      required: ['reference_doc_id'],
    },
    async execute(args) {
      const id = String(args.reference_doc_id ?? '');
      const ref = store.get(id);
      if (!ref) return { error: 'reference not found', referenceDocId: id };
      return {
        promptFragment: useReferenceDesignInPrompt(ref),
        sourceFilePath: ref.sourceFilePath,
        designUsable: ref.designUsable,
        docType: ref.docType,
        displayName: ref.displayName,
      };
    },
  };
}
