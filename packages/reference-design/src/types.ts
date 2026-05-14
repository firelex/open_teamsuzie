export type DocType =
  | 'el'           // engagement letter
  | 'offer'        // offer letter
  | 'ic-1pager'
  | 'ic-5pager'
  | 'ic-deck'      // PPTX
  | string;        // open for future doc types

export interface ReferenceDoc {
  id: string;
  docType: DocType;
  /** User-facing label, e.g. "IC5_Meridian.docx" or a friendlier name. */
  displayName: string;
  /** Path on disk to the original uploaded file. Kept for pandoc reference-doc usage. */
  sourceFilePath: string;
  /** Source MIME type. */
  sourceMime: string;
  /** Extracted markdown body — structure + voice. Used as system-prompt context. */
  contentMarkdown: string;
  /**
   * Whether the source file is usable as a pandoc `--reference-doc`.
   * True iff the original DOCX appears to use standard Word styles.
   * Heuristic only — false positives are fine; consumers can override.
   */
  designUsable: boolean;
  /** ISO 8601. */
  ingestedAt: string;
  /** Decomposition warnings, e.g. mammoth's "unsupported style". */
  warnings: string[];
}
