import type { WordDiffOp } from './word-diff.js';

/**
 * One event in a paragraph-level document diff.
 *
 * - `unchanged` — same text on both sides.
 * - `modified` — same paragraph identity (aligned), but text differs;
 *   `ops` is the word-level diff between left and right.
 * - `deleted` — left-only paragraph (removed in right).
 * - `inserted` — right-only paragraph (added in right).
 *
 * `leftIndex` / `rightIndex` are 0-based body-paragraph indices over
 * main-document `<w:p>` elements in editor order (including empty spacer
 * paragraphs and table-cell paragraphs) — the same index space a tracked
 * changes editor uses, so events can be applied directly without
 * translation.
 */
export type ParagraphDiffEvent =
  | {
      kind: 'unchanged';
      leftIndex: number;
      rightIndex: number;
      text: string;
    }
  | {
      kind: 'modified';
      leftIndex: number;
      rightIndex: number;
      leftText: string;
      rightText: string;
      ops: WordDiffOp[];
      similarity: number;
      moved: boolean;
    }
  | { kind: 'deleted'; leftIndex: number; text: string }
  | { kind: 'inserted'; rightIndex: number; text: string };

/**
 * Whole-document diff result. `events` is an ordered sequence over both
 * documents (A's flow with B's insertions slotted in at the right anchors);
 * `stats` is a roll-up for UI badges and reporting.
 */
export interface DocumentDiffResult {
  left: { name: string; paragraphs: number };
  right: { name: string; paragraphs: number };
  stats: {
    unchanged: number;
    modified: number;
    deleted: number;
    inserted: number;
    moved: number;
  };
  events: ParagraphDiffEvent[];
}
