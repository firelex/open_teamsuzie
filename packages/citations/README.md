# @teamsuzie/citations

Wire protocol and parser for inline-marker citations (`[1]`, `[2]`, ...) that an LLM attaches to its answers, plus helpers for preparing documents for the prompt and locating a cited quote back in the source text. Use it whenever a model answers questions about a document and you need the answer's claims traceable to verbatim source text.

```ts
import {
  citationProtocolFragment,
  prepareDocumentForPrompt,
  parseResponse,
  validateCitations,
  findHighlightRange,
} from '@teamsuzie/citations';

const doc = prepareDocumentForPrompt(fullText, pageBreaks, { handle: 'doc-1' });

const systemPrompt = [
  'Answer the user using only the document below.',
  doc.marked,
  citationProtocolFragment({ docs: [{ handle: doc.handle, label: 'Lease Agreement' }] }),
].join('\n\n');

// ... send systemPrompt + user question to the model, get back `raw` ...

const { text, citations, warnings } = parseResponse(raw, { knownDocs: [doc.handle] });
const results = validateCitations(citations, new Map([[doc.handle, doc]]));

// Find where a citation's quote sits in the original (un-normalized) text,
// to highlight it in a viewer.
const range = findHighlightRange(doc.text, citations[0].quote);
```

## Main exports

- `citationProtocolFragment(opts)` — renders the markdown instructions telling the model how to cite (inline `[N]` markers plus a trailing JSON block between `SENTINEL_OPEN`/`SENTINEL_CLOSE`).
- `parseResponse(raw, opts?)` — strips the citation block out of a model's raw reply and returns `{ text, citations, warnings }`. Warnings cover malformed JSON, duplicate ids, orphan markers, unreferenced entries, and (with `opts.knownDocs`) unknown doc handles.
- `prepareDocumentForPrompt(text, pageBreaks, opts?)` / `prepareDocumentFromPages(pages, opts?)` — build a `PreparedDocument` (`{ marked, handle, text, pageBreaks }`) with `[page N]` markers inserted at the given offsets, deriving a stable `handle` if none is supplied.
- `validateCitation(citation, doc)` / `validateCitations(citations, docs)` — drift-tolerant check that a citation's `quote` actually occurs in the document text.
- `findHighlightRange(haystack, needle, opts?)` — locates `needle` in `haystack` with smart-quote/dash/whitespace tolerance; falls back to a unique-token-window or shrinking-prefix match when the exact quote isn't found, so a highlight can still be shown.
- `normalize(s)` / `normalizeWithMap(s)` — the drift-tolerant text normalizer used throughout, with an offset map back to the original string.
- `remarkCitations()` / `parseCiteUrl(url)` — a remark plugin turning `[N]` markers into `cite:N` links for markdown renderers, plus the matching URL parser.

## Notable behaviour

- Only the first citation block in a reply is used; extra blocks are dropped with a `duplicate_block` warning.
- `parseResponse` never throws on malformed model output — it degrades to warnings so the caller can still show partial results.
- `findHighlightRange`'s prefix/window fallback only accepts a match when it is unique in the haystack, to avoid highlighting the wrong passage.

## Used by

`@teamsuzie/grid-review`, `@teamsuzie/grid-review-rag`, `@teamsuzie/agent-runtime`, and the citation-rendering components in `@teamsuzie/ui` (`cited-markdown-message`, `citation-chip`, `pdf-preview`, `docx-preview`, `review-grid`).
