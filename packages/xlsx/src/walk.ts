import type { Cell, Sheet, Workbook } from "./types.js";

export function walkCells(sheet: Sheet, fn: (cell: Cell) => void): void {
  for (const c of sheet.cells) fn(c);
}

export function resolveNamedRange(wb: Workbook, name: string): Cell[] {
  return wb.namedRanges.find((n) => n.name === name)?.cells ?? [];
}
