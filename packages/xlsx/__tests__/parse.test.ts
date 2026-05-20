import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbook } from "../src/parse.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/template.xlsx");

describe("parseWorkbook", () => {
  it("parses a workbook into a plain AST with sheets, cells, named ranges, and a source hash", async () => {
    const buf = readFileSync(FIXTURE);
    const wb = await parseWorkbook(buf);

    expect(wb.sheets.map((s) => s.name)).toEqual(["Assumptions", "Model"]);

    const assumptions = wb.sheets.find((s) => s.name === "Assumptions")!;
    expect(assumptions.cells.find((c) => c.address === "B1")?.value).toBe(1000);
    expect(assumptions.cells.find((c) => c.address === "B2")?.value).toBe(0.6);

    const model = wb.sheets.find((s) => s.name === "Model")!;
    const b2 = model.cells.find((c) => c.address === "B2");
    expect(b2?.type).toBe("formula");
    expect(b2?.formula).toBe("Assumptions!B1*(1-Assumptions!B2)");

    const named = wb.namedRanges.find((n) => n.name === "AssumptionsBlock");
    expect(named).toBeDefined();
    expect(named!.cells.length).toBeGreaterThan(0);

    expect(wb.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
