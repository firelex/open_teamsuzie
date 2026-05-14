# @teamsuzie/document-conversion

Facade over [`mammoth`](https://github.com/mwilliamson/mammoth.js) (DOCX→Markdown) and
[`markitdown-agent`](../../apps/agents/markitdown-agent/) (everything else → Markdown,
and Markdown → DOCX/PDF).

**Status:** Skeleton. Real implementation lands in Tasks A2 (`convertToMarkdown`) and
A5 (`exportMarkdownToDocx`, `exportMarkdownToPdf`) of the upstream extraction sweep
(`suziecode/docs/superpowers/plans/2026-05-14-upstream-extraction-sweep.md`).

## Public API (planned)

- `convertToMarkdown(bytes, { mime, filename, markitdownAgentBaseUrl })`
- `exportMarkdownToDocx(markdown, { markitdownAgentBaseUrl, referenceDocId? })`
- `exportMarkdownToPdf(markdown, { markitdownAgentBaseUrl })`
