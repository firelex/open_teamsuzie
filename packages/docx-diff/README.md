# @teamsuzie/docx-diff

Paragraph-level alignment and word-level diff between two document versions. Aligns two paragraph-string arrays with a Needleman–Wunsch pass over a containment-weighted similarity score (plus move detection for relocated paragraphs), then diffs matched-but-changed paragraphs word-by-word. Use it to build a "what changed between these two documents" view or to drive tracked-change generation (see `@teamsuzie/docx`'s `composeRedline`, which consumes this package's result types).

```ts
import { alignParagraphs, diffWords } from '@teamsuzie/docx-diff';

const left = [
  'The Borrower shall pay interest at the rate of 5% per annum.',
  'Either party may terminate upon thirty days written notice.',
];
const right = [
  'The Borrower shall pay interest at the rate of 7% per annum.',
  'Either party may terminate upon sixty days written notice.',
];

const alignment = alignParagraphs(left, right);

for (const match of alignment.matches) {
  if (match.bIndex === null) continue; // unmatched left paragraph
  const ops = diffWords(match.aText, match.bText);
  // ops: [{ kind: 'equal' | 'insert' | 'delete', text: string }, ...]
}

alignment.unmatchedB; // indices in `right` with no left-side counterpart
```

## Main exports

- `alignParagraphs(a, b, opts?)` — returns `AlignmentResult` (`{ matches, unmatchedB }`). Each `ParagraphMatch` carries `aIndex`, `bIndex`, `aText`, `bText`, `similarity`, `confident`, and `status` (`'ordered' | 'unmatched' | 'moved'`). `opts.minLengthRatio` (default 0.4) rejects pairings where one side is much longer than the other even if similarity would accept them.
- `diffWords(a, b)` — word-level LCS diff of two paragraph strings, returning `WordDiffOp[]` (`{ kind: 'equal' | 'insert' | 'delete', text }`), coalesced into runs, with deletes emitted before inserts at any tie.
- `containmentWeightedSimilarity(a, b)`, `tokenLcsLength`, `tokenize`, `fingerprint` — the similarity primitives `alignParagraphs` is built on, exposed for callers that want to score pairs themselves.
- Types `DocumentDiffResult` and `ParagraphDiffEvent` (`unchanged` / `modified` / `deleted` / `inserted`, with `leftIndex`/`rightIndex` over main-document paragraphs) describe the whole-document diff shape a caller assembles from `alignParagraphs` + `diffWords`; this package defines the type, not a builder function.

## Notable behaviour

- Comparison is case-sensitive and whitespace-exact — a capitalization change or stray double space shows up as a real diff. Callers wanting looser matching should normalize before calling.
- `alignParagraphs` detects moved paragraphs (same content, different position) via exact-fingerprint and mutual-best-fuzzy-similarity passes over the residue left after the primary monotonic alignment; these get `status: 'moved'` instead of `'unmatched'`.
- Both functions are pure and synchronous — no I/O.

## Used by

`@teamsuzie/docx` (`composeRedline`, `TrackedChangesEditor`), `@teamsuzie/agent-runtime` (document-diff and blackline/compare-document tools), and the redline components in `@teamsuzie/ui`.
