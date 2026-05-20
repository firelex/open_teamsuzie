// Public surface — implementations land in Tasks 2-4.
export type { Workbook, Sheet, Cell, NamedRange, WorkbookDiff, CellDiff, SheetDiff, DiffOptions } from "./types.js";
export { parseWorkbook } from "./parse.js";
export { walkCells, resolveNamedRange } from "./walk.js";
export { diffWorkbooks } from "./diff.js";
