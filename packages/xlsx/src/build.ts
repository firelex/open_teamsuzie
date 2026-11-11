import ExcelJS from "exceljs";

/** How a column's values are shown. Values are written as given; the
 *  format only sets Excel's number format and alignment. */
export type ColumnFormat = "text" | "number" | "currency" | "percent" | "date";

export interface BuildColumn {
  header: string;
  format?: ColumnFormat;
  /** Width in characters; derived from the content when omitted. */
  width?: number;
  /** ISO 4217 code for `currency` columns, e.g. "GBP". Default "USD". */
  currency?: string;
}

export type BuildCellValue = string | number | boolean | null;

export interface BuildSheet {
  name: string;
  columns: BuildColumn[];
  rows: BuildCellValue[][];
}

export interface BuildWorkbookSpec {
  sheets: BuildSheet[];
  /** Workbook "creator" metadata. */
  creator?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", JPY: "¥", CHF: "CHF " };

function numFmt(col: BuildColumn): string | undefined {
  switch (col.format) {
    case "number":
      return "#,##0.##";
    case "currency": {
      const code = (col.currency ?? "USD").toUpperCase();
      const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
      return `"${symbol}"#,##0.00`;
    }
    case "percent":
      return "0.0%";
    case "date":
      return "yyyy-mm-dd";
    default:
      return undefined;
  }
}

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ], unique. */
function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function cellValue(value: BuildCellValue, format: ColumnFormat | undefined): ExcelJS.CellValue {
  if (value === null) return null;
  if (format === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

/**
 * Write a workbook from a plain spec: one sheet per entry with a bold,
 * frozen header row, an autofilter, number formats per column, and
 * wrapped text in wide text columns. Throws when a row's length does not
 * match its sheet's column count, rather than shifting values silently.
 */
export async function buildWorkbook(spec: BuildWorkbookSpec): Promise<Buffer> {
  if (spec.sheets.length === 0) throw new Error("a workbook needs at least one sheet");
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.creator ?? "Team Suzie";
  wb.created = new Date();
  const used = new Set<string>();

  for (const sheet of spec.sheets) {
    if (sheet.columns.length === 0) throw new Error(`sheet "${sheet.name}" has no columns`);
    sheet.rows.forEach((row, i) => {
      if (row.length !== sheet.columns.length) {
        throw new Error(
          `sheet "${sheet.name}" row ${i + 1} has ${row.length} values but there are ${sheet.columns.length} columns`,
        );
      }
    });
    const ws = wb.addWorksheet(sheetName(sheet.name, used), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((col, c) => {
      const longest = Math.max(
        col.header.length,
        ...sheet.rows.map((r) => String(r[c] ?? "").length),
      );
      return { header: col.header, key: `c${c}`, width: col.width ?? Math.min(60, Math.max(10, longest + 2)) };
    });
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };

    for (const row of sheet.rows) {
      ws.addRow(row.map((v, c) => cellValue(v, sheet.columns[c]!.format)));
    }
    sheet.columns.forEach((col, c) => {
      const column = ws.getColumn(c + 1);
      const fmt = numFmt(col);
      if (fmt) column.numFmt = fmt;
      if ((col.format ?? "text") === "text") column.alignment = { wrapText: true, vertical: "top" };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
