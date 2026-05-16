/**
 * Pure DOCX redline pipeline: load bytes, snapshot paragraph texts,
 * apply a list of content-keyed tracked-change edits, and shape the
 * per-edit applied/error metadata that chat-side accept/reject UIs
 * consume. No file-store IO, no version-tracking, no URL building —
 * each consuming app wraps this with its own tool definition that
 * handles those layers.
 *
 * See `apps/suzielaw/src/tools/propose-edits.ts` (and the drafter
 * equivalent) for the host-side wrappers.
 */
import { loadDocx } from './docx-file.js';
import {
  applyContentKeyedEdits,
  type ContentKeyedEdit,
} from './content-keyed-edits.js';
import { bodyParagraphTexts } from './tracked-changes.js';
import { findEditParagraphIndex } from './redline-view.js';

export interface ProposeEditInput {
  find: string;
  replace: string;
  context_before: string;
  context_after: string;
  reason?: string;
}

export interface AppliedEdit {
  index: number;
  find: string;
  replace: string;
  context_before: string;
  context_after: string;
  reason?: string;
  revision_ids: number[];
  paragraph_index: number;
}

export interface ProposeEditError {
  index: number;
  /** Non-`'applied'` status from `applyContentKeyedEdits`
   * (e.g. `'not_found'`, `'ambiguous'`, `'no_op'`). */
  status: string;
  reason?: string;
  find: string;
  replace: string;
  original_reason?: string;
}

export interface ProposeEditsResult {
  applied_count: number;
  total: number;
  errors: ProposeEditError[];
  applied_edits: AppliedEdit[];
  /** New DOCX bytes — caller stores them however they like. */
  bytes: Buffer;
  /** Derive a filename for the redlined output from the source filename.
   *  Caller supplies the original name (it lives in the file-store record,
   *  not here). */
  suggested_filename: (originalName: string) => string;
  summary: string;
}

/**
 * Apply a list of content-keyed edits to a DOCX as tracked changes, and
 * return a structured result suitable for chat-side accept/reject UI.
 *
 * Pure: no file-store, no version-tracking, no URL building. Caller wraps
 * with its own IO. Both suzielaw and drafter use this — see each app's
 * `tools/propose-edits.ts` (or equivalent) for the IO wrapper.
 */
export function proposeDocumentEdits(opts: {
  docxBytes: Buffer | Uint8Array;
  edits: ProposeEditInput[];
  author: string;
}): ProposeEditsResult {
  if (!Array.isArray(opts.edits) || opts.edits.length === 0) {
    throw new Error('edits must be a non-empty array');
  }

  const file = loadDocx(opts.docxBytes);
  // Snapshot paragraph texts BEFORE we mutate so we can locate each
  // applied edit's paragraph index — `applyContentKeyedEdits` doesn't
  // surface that in its return shape, but the cards UI needs it to
  // anchor cards to inline runs in the redline preview.
  const paragraphTextsBefore = bodyParagraphTexts(file);
  const editsForApply: ContentKeyedEdit[] = opts.edits.map((e) => {
    const out: ContentKeyedEdit = {
      find: e.find,
      replace: e.replace,
      contextBefore: e.context_before,
      contextAfter: e.context_after,
    };
    if (e.reason !== undefined) out.reason = e.reason;
    return out;
  });
  const results = applyContentKeyedEdits(file, editsForApply, {
    name: opts.author,
  });

  const appliedCount = results.filter((r) => r.status === 'applied').length;
  const errors: ProposeEditError[] = results
    .map((r, i) => ({
      index: i,
      status: r.status,
      reason: r.reason,
      find: opts.edits[i].find,
      replace: opts.edits[i].replace,
      original_reason: opts.edits[i].reason,
    }))
    .filter((r) => r.status !== 'applied');

  // The accept/reject cards consume this: per-applied-edit metadata
  // + revision ids so the client can render Accept/Reject buttons
  // that hit the resolve endpoint by id, plus the source paragraph
  // index for inline-preview anchoring.
  const appliedEdits: AppliedEdit[] = results
    .map((r, i) => {
      if (r.status !== 'applied') return null;
      const e = opts.edits[i];
      const paragraphIndex = findEditParagraphIndex(
        paragraphTextsBefore,
        e.find,
        e.context_before,
        e.context_after,
      );
      const out: AppliedEdit = {
        index: i,
        find: e.find,
        replace: e.replace,
        context_before: e.context_before,
        context_after: e.context_after,
        revision_ids: r.revisionIds,
        paragraph_index: paragraphIndex,
      };
      if (e.reason !== undefined) out.reason = e.reason;
      return out;
    })
    .filter((x): x is AppliedEdit => x !== null);

  // Save the redline regardless of whether all edits applied — partial
  // proposals are useful (the user can accept what worked and try the
  // failures with more context).
  const bytes = file.save();

  const summary =
    appliedCount === opts.edits.length
      ? `All ${appliedCount} edit${appliedCount === 1 ? '' : 's'} applied as tracked changes.`
      : `${appliedCount} of ${opts.edits.length} edits applied; see errors for the rest.`;

  return {
    applied_count: appliedCount,
    total: opts.edits.length,
    errors,
    applied_edits: appliedEdits,
    bytes,
    suggested_filename: (originalName: string) => {
      const baseName = originalName.replace(/\.docx$/i, '');
      return `${baseName}__proposed_edits.docx`;
    },
    summary,
  };
}
