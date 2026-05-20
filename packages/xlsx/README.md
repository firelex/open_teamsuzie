# @teamsuzie/xlsx

Read-only structured access to `.xlsx` files. Designed to live in-process inside an agent loop.

## Surface

```ts
import { parseWorkbook, diffWorkbooks, walkCells, resolveNamedRange } from "@teamsuzie/xlsx";

const wb = await parseWorkbook(buffer);                         // Buffer → Workbook AST
walkCells(wb.sheets[0], (cell) => { /* ... */ });
const diff = diffWorkbooks(templateWb, candidateWb);            // → WorkbookDiff
const range = resolveNamedRange(wb, "AssumptionsBlock");        // → Cell[]
```

## Boundary

This package is **read-only**. For writes (template-fill, apply revisions, emit .xlsx), call the `xlsx-agent` sidecar at `~/mathias/apps/open_teamsuzie/apps/agents/xlsx-agent/`.
