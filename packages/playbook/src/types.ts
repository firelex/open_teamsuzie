/**
 * A customer's firm-preference playbook for a class of documents.
 * v1: a markdown blob. v1.1+ will add structured rule metadata
 * (id, severity, applies-to) extracted at ingestion time.
 */
export interface Playbook {
  id: string;
  title: string;
  /** Body in markdown. The LLM interprets this against a target doc. */
  body: string;
  /** Where the playbook came from (source file + ingestion timestamp). */
  source: PlaybookSource;
}

export interface PlaybookSource {
  /** Original filename (e.g. 'Blixt_EL_Playbook_v3.docx'). */
  filename: string;
  /** ISO 8601 when this playbook was ingested. */
  ingestedAt: string;
  /** Original MIME type. */
  originalMime: string;
}

/** A single flagged deviation found while applying a playbook. */
export interface Deviation {
  /** Short human-readable label, e.g. "Notice period below 30 days". */
  label: string;
  /** What the playbook says (the rule paragraph). */
  playbookExcerpt: string;
  /** What the target says (or absence-of). */
  targetExcerpt: string;
  /** Paragraph index in the target doc (0-based). null if absence. */
  targetParagraphIndex: number | null;
  /** Severity. v1: 'required' | 'preferred' | 'note', inferred from playbook text. */
  severity: 'required' | 'preferred' | 'note';
}

export interface DeviationReport {
  deviations: Deviation[];
  /** Markdown rendering of the report, suitable for export. */
  markdown: string;
}
