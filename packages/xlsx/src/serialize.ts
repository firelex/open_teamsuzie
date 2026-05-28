import type { Cell, Sheet, Workbook } from "./types.js";

export interface SerializeOptions {
  /** Token cap (rough char-count proxy, ~4 chars per token). Default 30000 → ~120000 chars. */
  tokenCap?: number;
}

/**
 * Token-efficient text representation of a workbook for LLM context.
 *
 * Per sheet, emits a header line, then one line per non-empty cell with:
 *   address: value [formula='...'] [fill=#XXXXXX] [font=#XXXXXX] [bold]
 *
 * For cells in column C or later, includes label context from column A or B
 * on the same row so the LLM doesn't need to cross-reference rows.
 *
 * Deterministic: sheets in workbook order, cells in (row, col) order within each sheet.
 */
export function serializeForLLM(workbook: Workbook, opts: SerializeOptions = {}): string {
  const tokenCap = opts.tokenCap ?? 30000;
  const charCap = tokenCap * 4;

  const out: string[] = [];
  for (const sheet of workbook.sheets) {
    if (sheet.cells.length === 0) continue;
    out.push(`=== Sheet: ${sheet.name} ===`);
    const labelMap = buildLabelMap(sheet);
    const sorted = [...sheet.cells].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const cell of sorted) {
      out.push(formatCell(cell, labelMap));
    }
    out.push("");
  }
  const joined = out.join("\n");
  if (joined.length <= charCap) return joined;
  return serializeTight(workbook, charCap);
}

function buildLabelMap(sheet: Sheet): Map<number, string> {
  const map = new Map<number, string>();
  for (const cell of sheet.cells) {
    if (cell.col !== 1 && cell.col !== 2) continue;
    if (typeof cell.value !== "string") continue;
    const label = cell.value.trim();
    if (!label) continue;
    const existing = map.get(cell.row);
    if (existing === undefined || cell.col === 2) {
      map.set(cell.row, label);
    }
  }
  return map;
}

function formatCell(cell: Cell, labelMap: Map<number, string>): string {
  const parts: string[] = [];
  parts.push(`${cell.address}:`);
  parts.push(renderValue(cell.value));
  if (cell.formula) parts.push(`formula='${cell.formula}'`);
  if (cell.fill) parts.push(`fill=${cell.fill}`);
  if (cell.fontColor) parts.push(`font=${cell.fontColor}`);
  if (cell.bold) parts.push("bold");
  if (cell.col >= 3) {
    const label = labelMap.get(cell.row);
    if (label) parts.push(`label="${label}"`);
  }
  return parts.join(" ");
}

function renderValue(v: Cell["value"]): string {
  if (v === null) return '""';
  if (v instanceof Date) return `date='${v.toISOString()}'`;
  if (typeof v === "string") return `"${v.replace(/"/g, '\\"')}"`;
  return String(v);
}

function serializeTight(workbook: Workbook, charCap: number): string {
  const out: string[] = [];
  let charCount = 0;
  let cellsRemaining = 0;
  // Count total non-empty cells for accurate truncation reporting.
  for (const sheet of workbook.sheets) {
    cellsRemaining += sheet.cells.length;
  }
  for (const sheet of workbook.sheets) {
    if (sheet.cells.length === 0) continue;
    const header = `=== Sheet: ${sheet.name} ===`;
    if (charCount + header.length > charCap) {
      out.push(`[... truncated, ${cellsRemaining} more cells]`);
      return out.join("\n");
    }
    out.push(header);
    charCount += header.length + 1;
    const labelMap = buildLabelMap(sheet);
    const sorted = [...sheet.cells].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const cell of sorted) {
      const v = renderValue(cell.value);
      const label = cell.col >= 3 ? labelMap.get(cell.row) ?? "" : "";
      const line = label ? `${cell.address}: ${v} | ${label}` : `${cell.address}: ${v}`;
      if (charCount + line.length > charCap) {
        out.push(`[... truncated, ${cellsRemaining} more cells]`);
        return out.join("\n");
      }
      out.push(line);
      charCount += line.length + 1;
      cellsRemaining -= 1;
    }
    out.push("");
    charCount += 1;
  }
  return out.join("\n");
}
