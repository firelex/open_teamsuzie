# @teamsuzie/docx

Lossless OOXML (`.docx`) parse + render, plus tracked-changes editing. Round-trips arbitrary Word documents preserving every zip part byte-for-byte except the ones you touch, and exposes `word/document.xml` as a typed-but-permissive XML tree for redline manipulation. Use it whenever an app needs to read, generate, or edit a `.docx` file — in particular to turn LLM-proposed edits into native Word tracked changes (`<w:ins>` / `<w:del>`) that a user can accept or reject in Word itself.

The package is organized around a few parts:

- **`DocxFile`** (`docx-file.ts`) — load/save a `.docx` package.
- **`TrackedChangesEditor`** (`tracked-changes.ts`) — low-level, index-based tracked-change mutations on a loaded file.
- **Content-keyed edits and the redline pipeline** (`content-keyed-edits.ts`, `propose-edits.ts`, `propose-edits-tool.ts`) — higher-level APIs that locate edits by surrounding text instead of paragraph index.
- **`composeRedline`** (`compose-redline.ts`) — builds a tracked-change `.docx` from a `@teamsuzie/docx-diff` paragraph diff.
- **`extractRedlineParagraphs`** (`redline-view.ts`) — reads tracked changes back out for UI rendering.
- **`generateDocx`** (`generate.ts`) — synthesizes a brand-new `.docx` from a structured spec.
- **`revisions.ts`** — list/accept/reject individual tracked changes.

```ts
import { loadDocx, TrackedChangesEditor, acceptAllRevisions } from '@teamsuzie/docx';

const file = loadDocx(sourceBytes);
const editor = new TrackedChangesEditor(file, { name: 'Review Bot' });

const paragraphs = editor.bodyParagraphCount();
editor.applyParagraphDiff(0, [
  { kind: 'equal', text: 'The Borrower shall pay interest at the rate of ' },
  { kind: 'delete', text: '5%' },
  { kind: 'insert', text: '7%' },
  { kind: 'equal', text: ' per annum.' },
], { inheritFormatting: true });

const redlinedBytes = file.save();

// Or resolve the tracked changes programmatically instead of in Word:
acceptAllRevisions(file);
const finalBytes = file.save();
```

Content-keyed editing (locate by text + context rather than paragraph index):

```ts
import { loadDocx, applyContentKeyedEdits } from '@teamsuzie/docx';

const file = loadDocx(sourceBytes);
const results = applyContentKeyedEdits(
  file,
  [{ find: '5%', replace: '7%', contextBefore: 'rate of ', contextAfter: ' per annum' }],
  { name: 'Review Bot' },
);
// results[0].status: 'applied' | 'not_found' | 'ambiguous' | 'no_op'
```

Generating a new document:

```ts
import { generateDocx } from '@teamsuzie/docx';

const bytes = await generateDocx({
  title: 'Term sheet',
  sections: [
    { heading: { text: 'Parties', level: 1 }, paragraphs: ['Buyer: Acme Holdings, LLC.'] },
    { heading: { text: 'Conditions', level: 1 }, table: { headers: ['Condition', 'Status'], rows: [['Diligence complete', 'Open']] } },
  ],
});
```

## Main exports

- `DocxFile` (`.load`, `listParts`, `hasPart`, `readPart`, `setPart`, `document`, `setDocument`, `markDocumentDirty`, `save`), plus `loadDocx` / `saveDocx` convenience functions.
- `parseXml` / `serializeXml` and the `XmlNode` / `XmlTree` / `XmlAttributes` types — the generic XML layer `DocxFile` is built on.
- `TrackedChangesEditor` — `applyParagraphDiff`, `deleteParagraph`, `insertParagraph`, `insertParagraphRich`, `insertClearWrapBreak(AfterFloatingAnchors)`, `getBodyParagraphPPr`, `overrideInsertedRunContent`, `bodyParagraphCount`. Helpers `bodyParagraphInfos` / `bodyParagraphTexts` read paragraph text and formatting without an editor instance; `computeNextRevisionId` picks the next safe `w:id`.
- `applyContentKeyedEdits(file, edits: ContentKeyedEdit[], author)` — locates each `find` by its unique `contextBefore`/`contextAfter` and applies it as a tracked change; edits in the same paragraph are batched into one `applyParagraphDiff` call.
- `proposeDocumentEdits({ docxBytes, edits, author })` — pure wrapper around `applyContentKeyedEdits` returning a UI-ready `ProposeEditsResult` (`applied_count`, `errors`, `applied_edits`, `bytes`, `suggested_filename`, `summary`). `buildProposeDocumentEditsTool(opts)` wraps that as an `@teamsuzie/agent-loop` tool definition with file-store and version-store IO.
- `composeRedline({ leftBytes, rightBytes?, diff, author, date? })` — builds a tracked-change `.docx` from a `DocumentDiffResult` (from `@teamsuzie/docx-diff`); `redlineDownloadFilename(...)` names the output.
- `extractRedlineParagraphs(file)` / `findEditParagraphIndex(...)` — read tracked changes back out as `RedlineParagraph[]` / `RedlineRun[]` for preview UIs.
- `listRevisions`, `acceptRevision`, `rejectRevision`, `acceptAllRevisions`, `rejectAllRevisions` — enumerate and resolve tracked changes by `Revision.id`.
- `generateDocx(spec: GenerateDocxSpec)` — renders a new `.docx` (via the `docx` npm package) from titles, headings, bullet/plain paragraphs, and simple tables; US Letter by default, `orientation: 'landscape'` optional.

## Notable behaviour and limits

- `TrackedChangesEditor`'s indexed APIs only see main-document body paragraphs (including table cells); headers, footers, footnotes, comments, and text boxes are out of scope.
- `applyParagraphDiff({ inheritFormatting: true })` tries to preserve per-run formatting by splitting the paragraph's existing runs at diff-op boundaries; if the diff text doesn't exactly match the paragraph's run text it falls back to copying the first run's `<w:rPr>` onto every generated run.
- `generateDocx` tables have no rowspan/colspan/nesting; rows shorter than the header are padded, longer rows truncated.
- `DocxFile.load` throws if the zip has no `word/document.xml`. `TrackedChangesEditor` methods throw on out-of-range paragraph indices.

## Used by

`@teamsuzie/agent-runtime` (redline router, generate/compare/blackline document tools, catalog modules) and the redline preview components in `@teamsuzie/ui`.
