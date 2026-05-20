import type { Cell, CellDiff, DiffOptions, SheetDiff, Workbook, WorkbookDiff } from "./types.js";

const DEFAULT_SEVERITY: Record<CellDiff["kind"], CellDiff["severity"]> = {
  missing: "high",
  extra: "low",
  value: "medium",
  formula: "high",
  type: "medium",
};

function fullRef(c: Cell): string {
  return `${c.sheet}!${c.address}`;
}

function snippet(c: Cell): string {
  if (c.type === "formula") return `${fullRef(c)} = ${c.formula} (= ${c.value ?? "?"})`;
  return `${fullRef(c)} = ${c.value ?? ""}`;
}

function cellKey(c: Cell): string {
  return `${c.sheet}!${c.address}`;
}

export function diffWorkbooks(
  template: Workbook,
  candidate: Workbook,
  opts: DiffOptions = {},
): WorkbookDiff {
  const ignoreEmpty = opts.ignoreEmptyCells ?? true;
  const ci = opts.caseInsensitiveSheetNames ?? true;
  const sev = { ...DEFAULT_SEVERITY, ...(opts.severityForKind ?? {}) };

  const normSheet = (s: string) => (ci ? s.toLowerCase() : s);

  // Structural diff.
  const structural: SheetDiff[] = [];
  const templateSheetNames = new Set(template.sheets.map((s) => normSheet(s.name)));
  const candidateSheetNames = new Set(candidate.sheets.map((s) => normSheet(s.name)));
  for (const s of template.sheets) {
    if (!candidateSheetNames.has(normSheet(s.name))) {
      structural.push({ templateName: s.name, candidateName: null, kind: "missing" });
    }
  }
  for (const s of candidate.sheets) {
    if (!templateSheetNames.has(normSheet(s.name))) {
      structural.push({ templateName: null, candidateName: s.name, kind: "extra" });
    }
  }

  // Cell-level diff over sheets present in both.
  const cells: CellDiff[] = [];
  for (const tSheet of template.sheets) {
    const cSheet = candidate.sheets.find((s) => normSheet(s.name) === normSheet(tSheet.name));
    if (!cSheet) continue;

    const tCells = new Map(tSheet.cells.map((c) => [cellKey(c), c]));
    const cCells = new Map(cSheet.cells.map((c) => [cellKey(c), c]));

    // Missing in candidate / type / formula / value
    for (const [key, t] of tCells) {
      if (ignoreEmpty && t.type === "empty") continue;
      const c = cCells.get(key);
      if (!c) {
        cells.push({
          templateRef: fullRef(t),
          candidateRef: null,
          kind: "missing",
          severity: sev.missing,
          templateSnippet: snippet(t),
          candidateSnippet: "(missing)",
        });
        continue;
      }
      if (t.type !== c.type) {
        cells.push({
          templateRef: fullRef(t),
          candidateRef: fullRef(c),
          kind: "type",
          severity: sev.type,
          templateSnippet: snippet(t),
          candidateSnippet: snippet(c),
        });
        continue;
      }
      if (t.type === "formula" && t.formula !== c.formula) {
        cells.push({
          templateRef: fullRef(t),
          candidateRef: fullRef(c),
          kind: "formula",
          severity: sev.formula,
          templateSnippet: snippet(t),
          candidateSnippet: snippet(c),
        });
        continue;
      }
      if (t.type !== "formula" && t.value !== c.value) {
        const sameDate = t.value instanceof Date && c.value instanceof Date && t.value.getTime() === c.value.getTime();
        if (sameDate) continue;
        cells.push({
          templateRef: fullRef(t),
          candidateRef: fullRef(c),
          kind: "value",
          severity: sev.value,
          templateSnippet: snippet(t),
          candidateSnippet: snippet(c),
        });
      }
    }

    // Extras in candidate
    for (const [key, c] of cCells) {
      if (ignoreEmpty && c.type === "empty") continue;
      if (!tCells.has(key)) {
        cells.push({
          templateRef: null,
          candidateRef: fullRef(c),
          kind: "extra",
          severity: sev.extra,
          templateSnippet: "(not in template)",
          candidateSnippet: snippet(c),
        });
      }
    }
  }

  return { structural, cells };
}
