import { describe, it, expect } from 'vitest';
import type {
  DocumentDiffResult,
  ParagraphDiffEvent,
} from '../document-diff-result.js';

describe('document-diff-result types', () => {
  it('types are importable', () => {
    const e: ParagraphDiffEvent = {
      kind: 'unchanged',
      leftIndex: 0,
      rightIndex: 0,
      text: 'hello',
    };
    expect(e).toBeDefined();

    const result: DocumentDiffResult = {
      left: { name: 'a.docx', paragraphs: 1 },
      right: { name: 'b.docx', paragraphs: 1 },
      stats: { unchanged: 1, modified: 0, deleted: 0, inserted: 0, moved: 0 },
      events: [e],
    };
    expect(result.events.length).toBe(1);
  });
});
