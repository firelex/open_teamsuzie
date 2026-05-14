# @teamsuzie/reference-design

Reference documents (customer-uploaded canonical examples) decomposed into
reusable structure + design metadata.

## Two concepts

- **Reference content** — markdown extraction of structure, sections, voice.
  Used as system-prompt context for drafting.
- **Reference design** — for DOCX, the original file used as
  `pandoc --reference-doc` template at export time. For PPTX, deferred to v1.1.

## Usage

```typescript
import {
  decomposeDocx,
  useReferenceDesignInPrompt,
} from '@teamsuzie/reference-design';

const ref = await decomposeDocx(uploadedBytes, {
  docType: 'ic-5pager',
  displayName: 'IC5_Meridian.docx',
  sourceFilePath: '/data/refs/ic5-meridian.docx',
});

// At draft time:
const promptFragment = useReferenceDesignInPrompt(ref);
// → include in system prompt; pass ref.sourceFilePath to exportMarkdownToDocx
//   as the referenceDoc when generating output.
```

## Status

v1: content extraction (DOCX + PPTX) + DOCX design via pandoc. v1.1:
PPTX design preservation, structured per-section metadata.
