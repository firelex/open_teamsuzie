export type CellType = "string" | "number" | "boolean" | "formula" | "date" | "error" | "empty";

export interface Cell {
  sheet: string;
  row: number;       // 1-indexed
  col: number;       // 1-indexed (A = 1)
  address: string;   // e.g. "B12"
  value: string | number | boolean | Date | null;
  formula?: string;  // present when type === 'formula'
  type: CellType;
  /** Fill color as hex string with leading '#', e.g. "#FFFACD". Undefined if no fill. */
  fill?: string;
  /** Font color as hex string with leading '#', e.g. "#0000FF". Undefined if default. */
  fontColor?: string;
  /** True if the cell font is bold. Undefined or false otherwise. */
  bold?: boolean;
}

export interface Sheet {
  name: string;
  rowCount: number;
  colCount: number;
  cells: Cell[];     // dense list, only non-empty cells included
}

export interface NamedRange {
  name: string;
  ref: string;       // e.g. "Assumptions!$A$1:$B$3"
  cells: Cell[];     // resolved at parse time
}

export interface Workbook {
  sheets: Sheet[];
  namedRanges: NamedRange[];
  sourceHash: string; // sha256 of the source buffer — used by callers for diff caching
}

export interface CellDiff {
  templateRef: string | null;   // e.g. "Assumptions!B12" — null when kind === 'extra'
  candidateRef: string | null;  //                        — null when kind === 'missing'
  kind: "missing" | "extra" | "value" | "formula" | "type";
  severity: "low" | "medium" | "high";
  templateSnippet: string;      // human-readable, e.g. "Assumptions!B12 = 1000"
  candidateSnippet: string;
}

export interface SheetDiff {
  templateName: string | null;
  candidateName: string | null;
  kind: "missing" | "extra" | "renamed";
}

export interface WorkbookDiff {
  structural: SheetDiff[];
  cells: CellDiff[];
}

export interface DiffOptions {
  ignoreEmptyCells?: boolean;     // default true
  caseInsensitiveSheetNames?: boolean; // default true
  severityForKind?: Partial<Record<CellDiff["kind"], CellDiff["severity"]>>;
}
