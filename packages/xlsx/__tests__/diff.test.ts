import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbook } from "../src/parse.js";
import { diffWorkbooks } from "../src/diff.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TEMPLATE = resolve(__dirname, "fixtures/template.xlsx");
const CANDIDATE = resolve(__dirname, "fixtures/candidate.xlsx");

describe("diffWorkbooks", () => {
  it("reports value diffs, formula diffs, and extra cells", async () => {
    const template = await parseWorkbook(readFileSync(TEMPLATE));
    const candidate = await parseWorkbook(readFileSync(CANDIDATE));
    const diff = diffWorkbooks(template, candidate);

    expect(diff.structural).toEqual([]);

    const byKind = (k: string) => diff.cells.filter((c) => c.kind === k);

    // Two value diffs: B1 (1000 → 1200), B2 (0.6 → 0.65)
    expect(byKind("value").map((c) => c.candidateRef).sort()).toEqual(["Assumptions!B1", "Assumptions!B2"]);

    // One formula diff: Model!B2
    expect(byKind("formula").map((c) => c.candidateRef)).toEqual(["Model!B2"]);

    // Two extras: Assumptions!A4, Assumptions!B4
    expect(byKind("extra").map((c) => c.candidateRef).sort()).toEqual(["Assumptions!A4", "Assumptions!B4"]);
  });

  it("reports missing sheets", async () => {
    const template = await parseWorkbook(readFileSync(TEMPLATE));
    const candidate = await parseWorkbook(readFileSync(CANDIDATE));
    candidate.sheets = candidate.sheets.filter((s) => s.name !== "Model");
    const diff = diffWorkbooks(template, candidate);
    expect(diff.structural.some((s) => s.kind === "missing" && s.templateName === "Model")).toBe(true);
  });
});
