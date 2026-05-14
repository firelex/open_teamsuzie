# @teamsuzie/document-conversion

Markdown ↔ binary document conversion for Team Suzie.

A thin facade over three backends:

- **`@teamsuzie/markdown-document`** for DOCX → Markdown (mammoth + turndown — best table fidelity)
- **`markitdown-agent`** service for everything else (PDF, PPTX, XLSX, HTML, EPUB → Markdown; Markdown → DOCX with optional `--reference-doc` styling)
- **`@teamsuzie/pdf`** for the Markdown → PDF step (DOCX intermediate → PDF via headless LibreOffice)

## API

```typescript
import {
  convertToMarkdown,
  exportMarkdownToDocx,
  exportMarkdownToPdf,
} from '@teamsuzie/document-conversion';

// Any binary → markdown
const { markdown } = await convertToMarkdown(bytes, {
  mime: 'application/pdf',
  filename: 'memo.pdf',
  markitdownAgentBaseUrl: 'http://localhost:3013',
});

// Markdown → DOCX with optional firm-style reference template
const docxBytes = await exportMarkdownToDocx({
  markdown,
  filename: 'output',
  referenceDoc: { bytes: refDocxBytes, filename: 'firm-template.docx' },
  markitdownAgentBaseUrl: 'http://localhost:3013',
});

// Markdown → PDF (intermediate DOCX → PDF via local LibreOffice)
const pdfBytes = await exportMarkdownToPdf({
  markdown,
  filename: 'output',
  markitdownAgentBaseUrl: 'http://localhost:3013',
});
```

## Why this exists

Suzielaw and other agents previously inlined the choice between mammoth and
markitdown-agent in each callsite (`files.ts`, `document-tools.ts`). This
package centralises that choice so consumers ask for "markdown from this
binary" and get the right backend automatically. The PDF export route relies
on `@teamsuzie/pdf` (LibreOffice) — see that package for setup.
