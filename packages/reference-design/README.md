# @teamsuzie/reference-design

Reference documents (customer-uploaded canonical examples) decomposed into reusable structure and design metadata for downstream drafting agents.

This is a placeholder skeleton. Real exports land in tasks B5 (types + `decomposeDocx`), B6 (`decomposePptx` with continuation tagging), and B7 (prompt helper + `ReferenceDocStore` interface).

## Scope

- Extracts markdown structure and voice from DOCX/PPTX uploads.
- Retains the original source file path for later pandoc `--reference-doc` use.
- Ships interfaces only — no concrete storage; agents bring their own (typically SQLite).
