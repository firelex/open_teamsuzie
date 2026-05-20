import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { Cell, CellType, NamedRange, Sheet, Workbook } from "./types.js";

function classifyCell(raw: ExcelJS.Cell): CellType {
  if (raw.formula) return "formula";
  switch (raw.type) {
    case ExcelJS.ValueType.Number: return "number";
    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.SharedString:
    case ExcelJS.ValueType.RichText: return "string";
    case ExcelJS.ValueType.Boolean: return "boolean";
    case ExcelJS.ValueType.Date: return "date";
    case ExcelJS.ValueType.Error: return "error";
    case ExcelJS.ValueType.Null:
    case ExcelJS.ValueType.Merge: return "empty";
    default: return "empty";
  }
}

function readValue(raw: ExcelJS.Cell): Cell["value"] {
  if (raw.value == null) return null;
  if (typeof raw.value === "object" && "result" in raw.value) {
    const r = (raw.value as { result?: unknown }).result;
    return r == null ? null : (r as Cell["value"]);
  }
  if (typeof raw.value === "object" && "richText" in raw.value) {
    return (raw.value as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  }
  return raw.value as Cell["value"];
}

function buildCell(sheetName: string, raw: ExcelJS.Cell): Cell {
  return {
    sheet: sheetName,
    row: raw.fullAddress.row,
    col: raw.fullAddress.col,
    address: raw.address,
    value: readValue(raw),
    formula: raw.formula ? raw.formula : undefined,
    type: classifyCell(raw),
  };
}

function resolveRefToCells(wb: Workbook, ref: string): Cell[] {
  const out: Cell[] = [];
  for (const part of ref.split(",")) {
    const m = part.match(/^([^!]+)!?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
    if (!m) continue;
    const [, sheetRaw, c1, r1, c2 = c1, r2 = r1] = m;
    const sheetName = sheetRaw.replace(/^'/, "").replace(/'$/, "");
    const sheet = wb.sheets.find((s) => s.name === sheetName);
    if (!sheet) continue;
    const colToNum = (s: string) => s.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    const c1n = colToNum(c1), c2n = colToNum(c2);
    const r1n = Number(r1), r2n = Number(r2);
    for (const cell of sheet.cells) {
      if (cell.col >= c1n && cell.col <= c2n && cell.row >= r1n && cell.row <= r2n) out.push(cell);
    }
  }
  return out;
}

export async function parseWorkbook(buffer: Buffer): Promise<Workbook> {
  const xlWb = new ExcelJS.Workbook();
  await xlWb.xlsx.load(buffer);

  const sheets: Sheet[] = xlWb.worksheets.map((ws) => {
    const cells: Cell[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (raw) => {
        cells.push(buildCell(ws.name, raw));
      });
    });
    return { name: ws.name, rowCount: ws.rowCount, colCount: ws.columnCount, cells };
  });

  const sourceHash = createHash("sha256").update(buffer).digest("hex");
  const wb: Workbook = { sheets, namedRanges: [], sourceHash };

  // Resolve named ranges from xlWb.model.definedNames.
  const modelDefs = (xlWb as unknown as { model: { definedNames: Array<{ name: string; ranges: string[] }> } }).model.definedNames;
  const ranges: Array<{ name: string; ranges: string[] }> = Array.isArray(modelDefs)
    ? modelDefs.map((d) => ({ name: d.name, ranges: d.ranges }))
    : [];

  wb.namedRanges = ranges.map((r) => ({
    name: r.name,
    ref: r.ranges.join(","),
    cells: resolveRefToCells(wb, r.ranges.join(",")),
  }));

  return wb;
}
